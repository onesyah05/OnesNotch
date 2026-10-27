//! Picks what to capture: the monitor holding the user's window and, in
//! window mode, that window's visible frame.
//!
//! Clicking a button in the notch makes the notch the foreground window, so
//! our own windows are skipped and the next real window in Z-order is used.

use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
    MonitorFromWindow,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GW_HWNDNEXT, GWL_EXSTYLE, GetClassNameW, GetCursorPos, GetForegroundWindow, GetTopWindow,
    GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, WS_EX_TOOLWINDOW,
};

use super::{CaptureError, CaptureTarget, Rect};

/// Upper bound on the Z-order walk; real desktops have far fewer windows.
const MAX_WALK: usize = 512;

pub(super) struct CapturePlan {
    pub monitor: HMONITOR,
    /// Full monitor rect in desktop coordinates.
    pub monitor_rect: Rect,
    /// Window rect (desktop coordinates, clipped to the monitor) in window mode.
    pub crop: Option<Rect>,
}

pub(super) fn resolve(target: CaptureTarget) -> Result<CapturePlan, CaptureError> {
    let window = user_window();

    let monitor = match window {
        // SAFETY: `hwnd` is a live top-level window handle.
        Some(hwnd) => unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) },
        None => cursor_monitor(),
    };
    if monitor.is_invalid() {
        return Err(CaptureError::NoMonitor);
    }
    let monitor_rect = monitor_rect(monitor)?;

    let crop = match (target, window) {
        (CaptureTarget::Window, Some(hwnd)) => {
            frame_bounds(hwnd).and_then(|rect| rect.intersect(monitor_rect))
        }
        _ => None,
    };

    Ok(CapturePlan {
        monitor,
        monitor_rect,
        crop,
    })
}

/// The window the user is working in, or `None` for the bare desktop.
fn user_window() -> Option<HWND> {
    // SAFETY: no arguments.
    let foreground = unsafe { GetForegroundWindow() };
    if is_candidate(foreground, false) {
        return Some(foreground);
    }
    if is_shell(foreground) {
        return None;
    }

    // Foreground is ours (or unusable): take the topmost real window instead.
    // SAFETY: `None` asks for the top of the desktop's Z-order.
    let mut current = unsafe { GetTopWindow(None) }.ok();
    for _ in 0..MAX_WALK {
        let hwnd = current?;
        if is_candidate(hwnd, true) {
            return Some(hwnd);
        }
        if is_shell(hwnd) {
            return None;
        }
        // SAFETY: `hwnd` is a window handle returned by the OS.
        current = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
    }
    None
}

fn is_candidate(hwnd: HWND, skip_tool_windows: bool) -> bool {
    if hwnd.is_invalid() {
        return false;
    }
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid out-pointer.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == std::process::id() {
        return false;
    }
    // SAFETY: read-only queries on a window handle.
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
        return false;
    }
    if skip_tool_windows {
        // SAFETY: read-only style query.
        let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        if ex_style & WS_EX_TOOLWINDOW.0 as isize != 0 {
            return false;
        }
    }
    if is_cloaked(hwnd) || is_shell(hwnd) {
        return false;
    }
    frame_bounds(hwnd).is_some()
}

/// Windows on other virtual desktops (and suspended UWP apps) are "cloaked":
/// visible to the API but not on screen.
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: `cloaked` is a u32 out-buffer of the size passed in.
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&raw mut cloaked).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

/// Desktop wallpaper and taskbar windows.
fn is_shell(hwnd: HWND) -> bool {
    if hwnd.is_invalid() {
        return false;
    }
    let mut buf = [0u16; 64];
    // SAFETY: `buf` is a valid UTF-16 buffer; the return value is its used length.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    let Ok(len) = usize::try_from(len) else {
        return false;
    };
    matches!(
        String::from_utf16_lossy(&buf[..len]).as_str(),
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    )
}

/// The visible frame, without the invisible resize borders `GetWindowRect` includes.
fn frame_bounds(hwnd: HWND) -> Option<Rect> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a RECT out-buffer of the size passed in.
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut rect).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    // SAFETY: `rect` is a valid out-pointer.
    if dwm.is_err() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    let rect = Rect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
    (!rect.is_empty()).then_some(rect)
}

fn cursor_monitor() -> HMONITOR {
    let mut point = POINT::default();
    // SAFETY: `point` is a valid out-pointer; on failure it stays at (0, 0).
    let _ = unsafe { GetCursorPos(&mut point) };
    // SAFETY: pure lookup with a value POINT and a documented flag.
    unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) }
}

fn monitor_rect(monitor: HMONITOR) -> Result<Rect, CaptureError> {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: `info` is sized via cbSize and outlives the call.
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err(CaptureError::NoMonitor);
    }
    let rect = info.rcMonitor;
    Ok(Rect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_some_monitor() {
        let plan = resolve(CaptureTarget::Screen).unwrap();
        assert!(!plan.monitor_rect.is_empty());
        assert!(plan.crop.is_none());
    }
}
