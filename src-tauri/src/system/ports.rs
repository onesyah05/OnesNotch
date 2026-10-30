//! Active network port inspection and process termination for developer utilities.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Command;
use sysinfo::{Pid, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub local_address: String,
    pub state: String,
    pub pid: u32,
    pub process_name: String,
}

/// Retrieve all listening TCP ports along with process name and PID.
pub async fn get_active_ports() -> AppResult<Vec<PortInfo>> {
    tokio::task::spawn_blocking(fetch_listening_ports)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn port task: {e}")))?
}

fn fetch_listening_ports() -> AppResult<Vec<PortInfo>> {
    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("netstat");
    cmd.args(["-ano", "-p", "tcp"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to execute netstat: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Internal(
            "netstat returned non-zero exit code".into(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Refresh sysinfo processes to resolve PIDs to process names
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut result = Vec::new();
    let mut seen = HashSet::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("TCP") {
            continue;
        }

        // Columns: Proto, Local Address, Foreign Address, State, PID
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let proto = parts[0];
        let local_addr = parts[1];
        let state = parts[3];
        let pid_str = parts[4];

        if state != "LISTENING" {
            continue;
        }

        let pid: u32 = match pid_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Extract port from local_addr (e.g. "0.0.0.0:8080" or "[::]:8080")
        let port: u16 = match local_addr.rsplit(':').next().and_then(|p| p.parse().ok()) {
            Some(p) => p,
            None => continue,
        };

        // Avoid exact duplicate (port, pid)
        if !seen.insert((port, pid)) {
            continue;
        }

        let process_name = if pid == 0 {
            "System Idle Process".to_string()
        } else if pid == 4 {
            "System".to_string()
        } else {
            sys.process(Pid::from_u32(pid))
                .map(|p| p.name().to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string())
        };

        result.push(PortInfo {
            port,
            protocol: proto.to_string(),
            local_address: local_addr.to_string(),
            state: state.to_string(),
            pid,
            process_name,
        });
    }

    // Sort by port number ascending
    result.sort_by_key(|item| item.port);

    Ok(result)
}

/// Terminate a process by PID.
pub async fn kill_process_by_pid(pid: u32) -> AppResult<()> {
    if pid == 0 || pid == 4 {
        return Err(AppError::InvalidInput(
            "Cannot terminate system critical process".into(),
        ));
    }

    tokio::task::spawn_blocking(move || kill_pid_sync(pid))
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn kill task: {e}")))?
}

fn kill_pid_sync(pid: u32) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Try taskkill /F /T /PID <pid> which terminates the process tree cleanly
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.output() {
            Ok(output) if output.status.success() => Ok(()),
            _ => {
                // Fallback to Win32 TerminateProcess
                use windows::Win32::Foundation::CloseHandle;
                use windows::Win32::System::Threading::{
                    OpenProcess, PROCESS_TERMINATE, TerminateProcess,
                };

                unsafe {
                    let handle = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|e| {
                        AppError::Internal(format!("Failed to open process {pid}: {e}"))
                    })?;
                    let res = TerminateProcess(handle, 1);
                    let _ = CloseHandle(handle);
                    res.map_err(|e| {
                        AppError::Internal(format!("Failed to terminate process {pid}: {e}"))
                    })?;
                }
                Ok(())
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}
