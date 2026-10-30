//! Launch with Windows via `tauri-plugin-autostart` (a `HKCU\...\Run` entry).

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

/// Adds or removes the Run entry so it matches `enabled`.
pub(crate) fn apply<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> AppResult<()> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|err| AppError::Internal(format!("failed to update autostart: {err}")))
}

/// Re-applies the stored choice on startup so the entry follows the current
/// executable path (e.g. after reinstalling elsewhere). Dev builds are
/// skipped so `tauri dev` never registers a debug binary to run at login.
pub(crate) fn sync_on_startup<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if cfg!(debug_assertions) {
        return;
    }
    if let Err(err) = apply(app, enabled) {
        tracing::warn!("{err}");
    }
}
