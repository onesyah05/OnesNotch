//! App and terminal runner commands.
//! Launches saved terminal presets or background tasks safely without blocking the UI.

use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub command: String,
    #[allow(dead_code)]
    pub command_stop: Option<String>,
    pub directory: Option<String>,
    pub terminal: Option<String>, // "auto" | "wt" | "powershell" | "cmd"
    pub mode: Option<String>,     // "terminal" | "background"
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRequest {
    pub pid: Option<u32>,
    pub command_stop: Option<String>,
    pub directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResponse {
    pub success: bool,
    pub message: String,
    pub pid: Option<u32>,
}

/// Execute a command in a terminal or in the background.
pub async fn execute_command(req: RunRequest) -> AppResult<RunResponse> {
    tokio::task::spawn_blocking(move || execute_command_sync(req))
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn runner task: {e}")))?
}

/// Stop an app or background process.
/// If `command_stop` is provided and non-empty, executes that stop command in the directory.
/// If `command_stop` is empty or not provided, defaults to Ctrl+C / terminating the PID process tree.
pub async fn stop_app(req: StopRequest) -> AppResult<RunResponse> {
    tokio::task::spawn_blocking(move || stop_app_sync(req))
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn runner stop task: {e}")))?
}

fn execute_command_sync(req: RunRequest) -> AppResult<RunResponse> {
    let command_str = req.command.trim();
    if command_str.is_empty() {
        return Err(AppError::InvalidInput("Command cannot be empty".into()));
    }

    let dir = req.directory.as_deref().map(str::trim).filter(|s| !s.is_empty());

    // Validate directory if provided
    if let Some(d) = dir {
        let p = Path::new(d);
        if !p.exists() {
            return Err(AppError::InvalidInput(format!("Directory '{d}' does not exist")));
        }
    }

    let is_background = req.mode.as_deref() == Some("background");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        if is_background {
            // Run silently in background using PowerShell
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", command_str]);
            if let Some(d) = dir {
                cmd.current_dir(d);
            }
            cmd.creation_flags(CREATE_NO_WINDOW);

            let child = cmd
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to start background process: {e}")))?;

            let pid = child.id();
            return Ok(RunResponse {
                success: true,
                message: format!("Process running in background (PID: {pid})"),
                pid: Some(pid),
            });
        }

        // Terminal window mode (interactive console)
        let term_choice = req.terminal.as_deref().unwrap_or("auto");

        let mut cmd = match term_choice {
            "cmd" => {
                let mut c = Command::new("cmd.exe");
                c.args(["/k", command_str]);
                c
            }
            _ => {
                let mut c = Command::new("powershell.exe");
                c.args(["-NoExit", "-Command", command_str]);
                c
            }
        };

        if let Some(d) = dir {
            cmd.current_dir(d);
        }
        cmd.creation_flags(CREATE_NEW_CONSOLE);

        let child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to launch terminal: {e}")))?;

        let pid = child.id();

        Ok(RunResponse {
            success: true,
            message: format!("Terminal launched (PID: {pid})"),
            pid: Some(pid),
        })
    }

    #[cfg(not(windows))]
    {
        let _ = (command_str, dir, is_background);
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}

fn stop_app_sync(req: StopRequest) -> AppResult<RunResponse> {
    let stop_cmd = req
        .command_stop
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let dir = req
        .directory
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Case 1: Custom stop command provided (e.g. "docker compose down")
    if let Some(cmd_str) = stop_cmd {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", cmd_str]);
            if let Some(d) = dir {
                cmd.current_dir(d);
            }
            cmd.creation_flags(CREATE_NO_WINDOW);

            let output = cmd
                .output()
                .map_err(|e| AppError::Internal(format!("Failed to execute stop command: {e}")))?;

            // If a PID was also tracked, terminate it as well to ensure clean exit
            if let Some(pid) = req.pid {
                let _ = kill_pid_sync(pid);
            }

            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Internal(format!("Stop command failed: {err_msg}")));
            }

            return Ok(RunResponse {
                success: true,
                message: format!("Stop command executed: {cmd_str}"),
                pid: None,
            });
        }
        #[cfg(not(windows))]
        {
            let _ = (cmd_str, dir);
            return Err(AppError::Internal("Only supported on Windows".into()));
        }
    }

    // Case 2: Default behavior when no stop command is provided: Ctrl+C / kill process tree
    if let Some(pid) = req.pid {
        kill_pid_sync(pid)?;
        Ok(RunResponse {
            success: true,
            message: format!("Process PID {pid} stopped (Ctrl+C / Terminated)"),
            pid: None,
        })
    } else {
        Ok(RunResponse {
            success: true,
            message: "No running PID or stop command specified".into(),
            pid: None,
        })
    }
}

fn kill_pid_sync(pid: u32) -> AppResult<()> {
    if pid == 0 || pid == 4 {
        return Err(AppError::InvalidInput(
            "Cannot terminate system critical process".into(),
        ));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| AppError::Internal(format!("Failed to terminate process: {e}")))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("not found") || stderr.contains("tidak ditemukan") {
                Ok(())
            } else {
                Err(AppError::Internal(format!(
                    "Failed to terminate process {pid}: {stderr}"
                )))
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}

/// Open a directory in Windows Explorer.
pub fn open_directory(directory: String) -> AppResult<()> {
    let trimmed = directory.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Directory cannot be empty".into()));
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(AppError::InvalidInput(format!("Directory '{trimmed}' does not exist")));
    }

    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(trimmed)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open directory: {e}")))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}

/// Open a native Windows folder picker dialog and return the selected path.
pub async fn pick_directory() -> AppResult<Option<String>> {
    tokio::task::spawn_blocking(pick_directory_sync)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn folder picker: {e}")))?
}

fn pick_directory_sync() -> AppResult<Option<String>> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Pilih Folder Project'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.SelectedPath
}
"#;

        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Sta", "-Command", script]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| AppError::Internal(format!("Failed to open folder picker: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            Ok(None)
        } else {
            Ok(Some(stdout))
        }
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}

/// Open a native Windows file picker dialog and return selected video files (supports multiselect).
pub async fn pick_video_files() -> AppResult<Vec<String>> {
    tokio::task::spawn_blocking(pick_video_files_sync)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn file picker: {e}")))?
}

fn pick_video_files_sync() -> AppResult<Vec<String>> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Pilih File Video MP4 Notch'
$dialog.Filter = 'Video Files (*.mp4;*.webm;*.mov)|*.mp4;*.webm;*.mov|All Files (*.*)|*.*'
$dialog.Multiselect = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    foreach ($file in $dialog.FileNames) {
        Write-Output $file
    }
}
"#;

        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Sta", "-Command", script]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| AppError::Internal(format!("Failed to open file picker: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let files: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        Ok(files)
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_command() {
        let req = RunRequest {
            command: "   ".into(),
            command_stop: None,
            directory: None,
            terminal: None,
            mode: None,
        };
        let res = execute_command_sync(req);
        assert!(res.is_err());
    }

    #[test]
    fn rejects_non_existent_directory() {
        let req = RunRequest {
            command: "echo test".into(),
            command_stop: None,
            directory: Some("Z:\\NonExistentPath_12345".into()),
            terminal: None,
            mode: None,
        };
        let res = execute_command_sync(req);
        assert!(res.is_err());
    }

    #[test]
    fn stop_sync_handles_empty_pid_and_stop_command() {
        let req = StopRequest {
            pid: None,
            command_stop: None,
            directory: None,
        };
        let res = stop_app_sync(req);
        assert!(res.is_ok());
    }
}
