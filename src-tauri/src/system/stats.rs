//! Realtime battery status and network throughput monitor.
//!
//! Provides battery level/charging state via Win32 `GetSystemPowerStatus`
//! and network download/upload speeds in Mbps via `sysinfo::Networks`.

use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sysinfo::{Components, Networks, System};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    /// Level in percent (0 - 100), or None if desktop PC without battery.
    pub level: Option<u8>,
    /// Whether actively charging.
    pub charging: bool,
    /// Whether connected to AC wall power.
    pub ac_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSpeed {
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
    pub rx_mbps: f64,
    pub tx_mbps: f64,
    pub total_mbps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TopProcess {
    pub name: String,
    pub cpu_usage: f32,
    pub memory_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareStats {
    pub cpu_usage: f32,
    pub cpu_temp: f32,
    pub is_temp_estimated: bool,
    pub ram_used_bytes: u64,
    pub ram_total_bytes: u64,
    pub ram_usage_percent: f32,
    pub top_process: Option<TopProcess>,
    pub is_heavy_load: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub battery: BatteryInfo,
    pub network: NetworkSpeed,
    pub hardware: HardwareStats,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct SystemPowerStatusRaw {
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
    battery_life_time: u32,
    battery_full_life_time: u32,
}

#[cfg(windows)]
unsafe extern "system" {
    fn GetSystemPowerStatus(lpSystemPowerStatus: *mut SystemPowerStatusRaw) -> i32;
}

pub fn read_battery() -> BatteryInfo {
    #[cfg(windows)]
    {
        let mut raw = SystemPowerStatusRaw::default();
        // SAFETY: `raw` is a valid stack-allocated Win32 struct matching OS ABI.
        let ok = unsafe { GetSystemPowerStatus(&mut raw) };
        if ok != 0 {
            let has_no_battery = (raw.battery_flag & 128) != 0 || raw.battery_life_percent == 255;
            let level = if has_no_battery || raw.battery_life_percent > 100 {
                None
            } else {
                Some(raw.battery_life_percent)
            };
            let charging = (raw.battery_flag & 8) != 0;
            let ac_online = raw.ac_line_status == 1;

            return BatteryInfo {
                level,
                charging,
                ac_online,
            };
        }
    }

    BatteryInfo {
        level: None,
        charging: false,
        ac_online: true,
    }
}

pub struct NetworkMonitor {
    networks: Mutex<Networks>,
    last_tick: Mutex<Instant>,
}

impl Default for NetworkMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkMonitor {
    pub fn new() -> Self {
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(true);
        Self {
            networks: Mutex::new(networks),
            last_tick: Mutex::new(Instant::now()),
        }
    }

    pub fn sample(&self) -> NetworkSpeed {
        let Ok(mut net) = self.networks.lock() else {
            return NetworkSpeed {
                rx_bytes_per_sec: 0,
                tx_bytes_per_sec: 0,
                rx_mbps: 0.0,
                tx_mbps: 0.0,
                total_mbps: 0.0,
            };
        };

        let Ok(mut last) = self.last_tick.lock() else {
            return NetworkSpeed {
                rx_bytes_per_sec: 0,
                tx_bytes_per_sec: 0,
                rx_mbps: 0.0,
                tx_mbps: 0.0,
                total_mbps: 0.0,
            };
        };

        let now = Instant::now();
        let elapsed = now.duration_since(*last).as_secs_f64().max(0.1);
        *last = now;

        net.refresh(true);

        let mut total_rx = 0u64;
        let mut total_tx = 0u64;

        for (name, data) in net.iter() {
            let name_lower = name.to_ascii_lowercase();
            if name_lower.contains("loopback") || name_lower.starts_with("lo") {
                continue;
            }
            total_rx += data.received();
            total_tx += data.transmitted();
        }

        let rx_bytes_sec = (total_rx as f64 / elapsed) as u64;
        let tx_bytes_sec = (total_tx as f64 / elapsed) as u64;
        let rx_mbps = (rx_bytes_sec as f64 * 8.0) / 1_000_000.0;
        let tx_mbps = (tx_bytes_sec as f64 * 8.0) / 1_000_000.0;
        let total_mbps = rx_mbps + tx_mbps;

        NetworkSpeed {
            rx_bytes_per_sec: rx_bytes_sec,
            tx_bytes_per_sec: tx_bytes_sec,
            rx_mbps: (rx_mbps * 100.0).round() / 100.0,
            tx_mbps: (tx_mbps * 100.0).round() / 100.0,
            total_mbps: (total_mbps * 100.0).round() / 100.0,
        }
    }
}

pub struct HardwareMonitor {
    system: Mutex<System>,
    components: Mutex<Option<Components>>,
}

impl Default for HardwareMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl HardwareMonitor {
    pub fn new() -> Self {
        // Do NOT initialize Components here; on Windows Components queries WMI/COM,
        // which calls CoInitializeEx(MTA) and breaks tao's OleInitialize (STA) on thread 'main'.
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();
        Self {
            system: Mutex::new(system),
            components: Mutex::new(None),
        }
    }

    pub fn sample(&self) -> HardwareStats {
        let Ok(mut sys) = self.system.lock() else {
            return HardwareStats {
                cpu_usage: 0.0,
                cpu_temp: 45.0,
                is_temp_estimated: true,
                ram_used_bytes: 0,
                ram_total_bytes: 0,
                ram_usage_percent: 0.0,
                top_process: None,
                is_heavy_load: false,
            };
        };

        sys.refresh_cpu_usage();
        sys.refresh_memory();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        let cpu_usage = (sys.global_cpu_usage() * 10.0).round() / 10.0;
        let ram_total_bytes = sys.total_memory();
        let ram_used_bytes = sys.used_memory();
        let ram_usage_percent = if ram_total_bytes > 0 {
            ((ram_used_bytes as f64 / ram_total_bytes as f64 * 1000.0).round() / 10.0) as f32
        } else {
            0.0
        };

        // Try reading real temperature from Components (lazily created on worker thread)
        let mut real_temp = None;
        if let Ok(mut comps_guard) = self.components.lock() {
            if comps_guard.is_none() {
                *comps_guard = Some(Components::new_with_refreshed_list());
            }
            if let Some(comps) = comps_guard.as_mut() {
                comps.refresh(true);
                for c in comps.iter() {
                    let label = c.label().to_ascii_lowercase();
                    let is_cpu = label.contains("cpu")
                        || label.contains("core")
                        || label.contains("package")
                        || label.contains("tctl")
                        || label.contains("tdie")
                        || label.contains("processor");
                    if is_cpu
                        && let Some(t) = c.temperature()
                        && (0.0..125.0).contains(&t)
                    {
                        real_temp = Some(t);
                        break;
                    }
                }
                if real_temp.is_none() {
                    for c in comps.iter() {
                        if let Some(t) = c.temperature()
                            && (0.0..125.0).contains(&t)
                        {
                            real_temp = Some(t);
                            break;
                        }
                    }
                }
            }
        }

        let (cpu_temp, is_temp_estimated) = match real_temp {
            Some(t) => ((t * 10.0).round() / 10.0, false),
            None => {
                // Realistic thermal baseline on modern Windows hardware
                let estimated = 38.0 + (cpu_usage * 0.42).clamp(0.0, 52.0);
                ((estimated * 10.0).round() / 10.0, true)
            }
        };

        // Top process by CPU usage
        let mut top: Option<TopProcess> = None;
        for proc in sys.processes().values() {
            let name = proc.name().to_string_lossy();
            let name_lower = name.to_ascii_lowercase();
            if name_lower.contains("idle")
                || name_lower == "system"
                || name_lower.contains("registry")
                || name_lower.contains("memory compression")
            {
                continue;
            }
            let cpu = proc.cpu_usage();
            if top.as_ref().map(|t| cpu > t.cpu_usage).unwrap_or(true) && cpu > 1.5 {
                top = Some(TopProcess {
                    name: name.to_string(),
                    cpu_usage: (cpu * 10.0).round() / 10.0,
                    memory_mb: proc.memory() / (1024 * 1024),
                });
            }
        }

        let is_heavy_load = cpu_usage >= 65.0
            || ram_usage_percent >= 85.0
            || top.as_ref().map(|p| p.cpu_usage >= 35.0).unwrap_or(false);

        HardwareStats {
            cpu_usage,
            cpu_temp,
            is_temp_estimated,
            ram_used_bytes,
            ram_total_bytes,
            ram_usage_percent,
            top_process: top,
            is_heavy_load,
        }
    }
}

pub struct SystemStatsMonitor {
    pub network: NetworkMonitor,
    pub hardware: HardwareMonitor,
    cached: Mutex<Option<SystemStats>>,
}

impl Default for SystemStatsMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemStatsMonitor {
    pub fn new() -> Self {
        Self {
            network: NetworkMonitor::new(),
            hardware: HardwareMonitor::new(),
            cached: Mutex::new(None),
        }
    }

    pub fn sample(&self) -> SystemStats {
        let stats = SystemStats {
            battery: read_battery(),
            network: self.network.sample(),
            hardware: self.hardware.sample(),
        };
        if let Ok(mut c) = self.cached.lock() {
            *c = Some(stats.clone());
        }
        stats
    }

    pub fn get_cached_or_sample(&self) -> SystemStats {
        if let Ok(c) = self.cached.lock()
            && let Some(stats) = &*c
        {
            return stats.clone();
        }
        self.sample()
    }
}

pub fn current_stats(monitor: &SystemStatsMonitor) -> SystemStats {
    monitor.get_cached_or_sample()
}

pub fn spawn_stats_emitter<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let spawn = std::thread::Builder::new()
        .name("system-stats".into())
        .spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));

                let is_panic = app
                    .try_state::<crate::state::AppState>()
                    .map(|s| s.panic_active())
                    .unwrap_or(false);
                if is_panic {
                    continue;
                }

                if let Some(monitor) = app.try_state::<SystemStatsMonitor>() {
                    let stats = monitor.sample();
                    let _ = app.emit_to("notch", "system://stats", &stats);
                }
            }
        });

    if let Err(err) = spawn {
        tracing::warn!("failed to spawn system stats emitter: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_battery_without_panic() {
        let battery = read_battery();
        if let Some(pct) = battery.level {
            assert!(pct <= 100);
        }
    }

    #[test]
    fn samples_network_speed() {
        let monitor = NetworkMonitor::new();
        let speed = monitor.sample();
        assert!(speed.total_mbps >= 0.0);
    }

    #[test]
    fn samples_hardware_stats() {
        let monitor = HardwareMonitor::new();
        let hw = monitor.sample();
        assert!(hw.cpu_usage >= 0.0);
        assert!(hw.cpu_temp > 0.0);
        assert!(hw.ram_total_bytes > 0);
    }
}
