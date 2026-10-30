//! Notch window shell: creation-time stealth, placement, hover and background workers.
//!
//! Every window created by `tauri.conf.json` or at runtime must pass through
//! `stealth::apply`/`stealth::apply_all` (AGENTS.md rule 1). The setup hook
//! calls [`apply_all`] before anything else.

pub(crate) mod hover;
pub(crate) mod position;
pub(crate) mod stealth;

pub(crate) use stealth::apply_all;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Logical window size. The pill is drawn inside it at `PILL_TOP`.
pub(crate) const LOGICAL_WIDTH: f64 = 640.0;
pub(crate) const LOGICAL_HEIGHT: f64 = 480.0;
/// Distance from the top of the work area to the pill, in logical pixels.
/// Zero: the notch hangs from the screen edge like a hardware notch.
pub(crate) const PILL_TOP: f64 = 0.0;

pub(crate) fn spawn_background_workers<R: Runtime>(app: AppHandle<R>) {
    hover::spawn(app.clone());
    position::spawn_monitor_watcher(app);
}

/// Recreates the settings window when the configured one is gone. It is
/// created hidden and must still go through stealth (AGENTS.md rule 1).
pub(crate) fn recreate_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let visible_in_capture = app
        .try_state::<crate::state::AppState>()
        .map(|state| state.visible_in_capture())
        .unwrap_or(false);
    let window = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("OnesNotch Settings")
        .inner_size(760.0, 560.0)
        .resizable(true)
        .center()
        .visible(false)
        .skip_taskbar(true)
        .shadow(true)
        .build()?;
    if let Err(err) = stealth::apply(&window, visible_in_capture) {
        tracing::error!("failed to apply stealth to recreated settings: {err}");
    }
    Ok(window)
}
