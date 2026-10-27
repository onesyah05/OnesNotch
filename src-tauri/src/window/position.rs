//! Top-center placement on the active monitor, with per-monitor DPI.
//!
//! Placement reads the Win32 work area directly instead of Tauri's
//! `Monitor::work_area()`, whose type is not part of the stable API used here.
//! A watcher repositions the notch when monitors or the cursor monitor change.

use tauri::{AppHandle, Runtime};

use crate::error::AppResult;

pub(crate) fn place<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    #[cfg(windows)]
    {
        platform::place(app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

/// Repositions the notch whenever the monitor layout changes.
pub(crate) fn spawn_monitor_watcher<R: Runtime>(app: AppHandle<R>) {
    #[cfg(windows)]
    {
        platform::spawn_watcher(app);
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

#[cfg(windows)]
mod platform {
    use std::time::Duration;

    use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime};
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY, MONITORINFO,
        MonitorFromPoint, MonitorFromWindow,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetForegroundWindow};

    use crate::error::{AppError, AppResult};
    use crate::window::{LOGICAL_HEIGHT, LOGICAL_WIDTH};

    const WATCH_INTERVAL: Duration = Duration::from_secs(1);

    pub(super) fn place<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
        let Some(window) = app.get_webview_window("notch") else {
            return Ok(());
        };
        let (size, position) = target_geometry()?;
        window
            .set_size(size)
            .map_err(|err| AppError::Internal(format!("failed to resize notch: {err}")))?;
        window
            .set_position(position)
            .map_err(|err| AppError::Internal(format!("failed to reposition notch: {err}")))?;
        Ok(())
    }

    pub(super) fn spawn_watcher<R: Runtime>(app: AppHandle<R>) {
        let spawn = std::thread::Builder::new()
            .name("notch-monitor".into())
            .spawn(move || {
                let mut last = monitor_signature(&app);
                loop {
                    std::thread::sleep(WATCH_INTERVAL);
                    let current = monitor_signature(&app);
                    if current == last {
                        continue;
                    }
                    if let Err(err) = place(&app) {
                        tracing::warn!("failed to reposition notch: {err}");
                    }
                    last = current;
                }
            });

        if let Err(err) = spawn {
            tracing::warn!("failed to spawn monitor watcher: {err}");
        }
    }

    fn target_geometry() -> AppResult<(PhysicalSize<u32>, PhysicalPosition<i32>)> {
        let monitor = target_monitor()?;
        let scale = monitor_scale(monitor);
        let width = (LOGICAL_WIDTH * scale).round().max(1.0) as u32;
        let height = (LOGICAL_HEIGHT * scale).round().max(1.0) as u32;
        let work = work_area(monitor)?;

        // Pill is horizontally centered and sits flush with the usable top.
        let x = work.left + ((work.right - work.left) - width as i32) / 2;
        let y = work.top;

        Ok((
            PhysicalSize::new(width, height),
            PhysicalPosition::new(x, y),
        ))
    }

    fn target_monitor() -> AppResult<HMONITOR> {
        let mut cursor = POINT::default();
        // SAFETY: `cursor` is a valid out-pointer for the duration of the call.
        if unsafe { GetCursorPos(&mut cursor) }.is_ok() {
            // SAFETY: pure lookup with a value POINT and a documented flag.
            return valid_monitor(unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) });
        }

        // SAFETY: no arguments, always safe to call.
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0.is_null() {
            // SAFETY: pure lookup with a value POINT and a documented flag.
            valid_monitor(unsafe {
                MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
            })
        } else {
            // SAFETY: `foreground` is a window handle returned by the OS.
            valid_monitor(unsafe { MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) })
        }
    }

    fn valid_monitor(monitor: HMONITOR) -> AppResult<HMONITOR> {
        if monitor.0.is_null() {
            Err(AppError::Internal("no monitor available".into()))
        } else {
            Ok(monitor)
        }
    }

    fn work_area(monitor: HMONITOR) -> AppResult<RECT> {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        // SAFETY: `info` is sized via cbSize and outlives the call.
        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return Err(AppError::Internal("GetMonitorInfoW failed".into()));
        }
        Ok(info.rcWork)
    }

    fn monitor_scale(monitor: HMONITOR) -> f64 {
        let mut dpi_x = 0;
        let mut dpi_y = 0;
        // SAFETY: `monitor` comes from the OS and both out-pointers are valid.
        match unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) } {
            Ok(()) if dpi_x > 0 => f64::from(dpi_x) / 96.0,
            _ => 1.0,
        }
    }

    /// Cheap snapshot used to detect monitor layout or cursor-monitor changes.
    #[derive(Debug, Default, PartialEq, Eq)]
    struct MonitorSignature {
        monitors: Vec<(i32, i32, u32, u32, u64)>,
        cursor: Option<(i32, i32, i32, i32)>,
    }

    fn monitor_signature<R: Runtime>(app: &AppHandle<R>) -> MonitorSignature {
        let mut monitors = app
            .available_monitors()
            .map(|list| {
                list.iter()
                    .map(|monitor| {
                        let position = monitor.position();
                        let size = monitor.size();
                        (
                            position.x,
                            position.y,
                            size.width,
                            size.height,
                            monitor.scale_factor().to_bits(),
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        monitors.sort_unstable();

        let mut point = POINT::default();
        // SAFETY: `point` is a valid out-pointer for the duration of the call.
        let cursor = if unsafe { GetCursorPos(&mut point) }.is_ok() {
            // SAFETY: pure lookup with a value POINT and a documented flag.
            let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
            work_area(monitor)
                .ok()
                .map(|rect| (rect.left, rect.top, rect.right, rect.bottom))
        } else {
            None
        };

        MonitorSignature { monitors, cursor }
    }
}
