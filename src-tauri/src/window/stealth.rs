//! Screen-capture invisibility (AGENTS.md rule 1).
//!
//! Every window must pass through [`apply`] right after it is created. Windows
//! 10 2004+ uses `WDA_EXCLUDEFROMCAPTURE`; older builds fall back to
//! `WDA_MONITOR`, which blanks the window in captures instead of removing it.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::error::AppResult;

/// Hides a window from screen capture and from the taskbar/Alt-Tab list.
///
/// "Visible in capture" only ever applies to windows that are on screen. A
/// hidden window that loses `WDA_EXCLUDEFROMCAPTURE` still turns up in
/// screenshots as a blank white frame, so hidden windows always stay excluded;
/// [`hide`] and the show paths re-apply this whenever visibility changes.
pub(crate) fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    visible_in_capture: bool,
) -> AppResult<()> {
    let visible_in_capture = visible_in_capture && window.is_visible().unwrap_or(false);
    #[cfg(windows)]
    {
        windows_impl::apply(window, visible_in_capture)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, visible_in_capture);
        Ok(())
    }
}

/// Hides a window and puts it back under capture exclusion (see [`apply`]).
pub(crate) fn hide<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.hide()?;
    if let Err(err) = apply(window, false) {
        tracing::error!("failed to re-apply stealth to hidden window: {err}");
    }
    Ok(())
}

/// Applies stealth to every existing window.
///
/// A window that cannot be hidden is logged and skipped: one failure must not
/// leave the remaining windows exposed.
pub(crate) fn apply_all<R: Runtime>(app: &AppHandle<R>, visible_in_capture: bool) {
    for (label, window) in app.webview_windows() {
        if let Err(err) = apply(&window, visible_in_capture) {
            tracing::error!("failed to apply stealth to window '{label}': {err}");
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use tauri::{Runtime, WebviewWindow};
    use windows::Win32::Foundation::{GetLastError, HWND, SetLastError, WIN32_ERROR};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW,
        WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WDA_NONE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    use crate::error::{AppError, AppResult};
    use crate::system;

    pub(super) fn apply<R: Runtime>(
        window: &WebviewWindow<R>,
        visible_in_capture: bool,
    ) -> AppResult<()> {
        let raw = window
            .hwnd()
            .map_err(|err| AppError::Internal(format!("no window handle: {err}")))?;
        let hwnd = HWND(raw.0);
        set_affinity(hwnd, visible_in_capture)?;
        hide_from_taskbar(hwnd)
    }

    fn set_affinity(hwnd: HWND, visible_in_capture: bool) -> AppResult<()> {
        let affinity = if visible_in_capture {
            WDA_NONE
        } else if system::supports_capture_exclusion() {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            static WARNED: std::sync::Once = std::sync::Once::new();
            WARNED.call_once(|| {
                tracing::warn!("this Windows build predates 10 2004; falling back to WDA_MONITOR");
            });
            WDA_MONITOR
        };

        // SAFETY: `hwnd` is a live top-level window and `affinity` is one of the
        // three documented WDA_* values.
        unsafe { SetWindowDisplayAffinity(hwnd, affinity) }
            .map_err(|err| AppError::Internal(format!("SetWindowDisplayAffinity failed: {err}")))
    }

    fn hide_from_taskbar(hwnd: HWND) -> AppResult<()> {
        // SAFETY: `hwnd` is a live top-level window; GWL_EXSTYLE is a valid index.
        let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        let wanted = (current | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        if wanted == current {
            return Ok(());
        }

        // A zero return is ambiguous on its own, so clear the error first
        // (this is the documented GetWindowLongPtr pattern).
        // SAFETY: writes to this thread's error state only.
        unsafe { SetLastError(WIN32_ERROR(0)) };
        // SAFETY: `hwnd` is a live top-level window and `wanted` is a valid style set.
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted) };
        // SAFETY: reads this thread's error state.
        let error = unsafe { GetLastError() };
        if error != WIN32_ERROR(0) {
            return Err(AppError::Internal(format!(
                "SetWindowLongPtrW failed: {}",
                error.0
            )));
        }
        Ok(())
    }
}
