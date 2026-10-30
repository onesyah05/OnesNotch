//! Cursor polling that toggles click-through around the pill and emits hover events.
//!
//! The window is larger than the pill so the expanded panel has room, so a
//! simple "ignore clicks when the cursor is outside the window" rule does not
//! work: the pill rect inside the window has to be tested instead.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};

use crate::state::{AppState, NotchState};

use super::{LOGICAL_WIDTH, PILL_TOP};

const POLL_INTERVAL: Duration = Duration::from_millis(16);
const HOVER_MARGIN: f64 = 6.0;
/// Height of the hot strip along the screen edge while auto-hide has the
/// notch tucked away. Thin, so browser tabs under it stay clickable.
const REVEAL_STRIP: f64 = 4.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoverEvent {
    inside: bool,
}

pub(crate) fn spawn<R: Runtime>(app: AppHandle<R>) {
    let spawn = std::thread::Builder::new()
        .name("notch-hover".into())
        .spawn(move || poll(&app));

    if let Err(err) = spawn {
        tracing::warn!("failed to spawn hover watcher: {err}");
    }
}

fn poll<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let mut inside = false;
    #[cfg(windows)]
    let mut was_mouse_down = false;

    loop {
        std::thread::sleep(POLL_INTERVAL);

        let Some(window) = app.get_webview_window("notch") else {
            break;
        };

        // While the panic flag is set every window is hidden, so there is
        // nothing to hover and no click-through state to update.
        if state.inner().panic_active() {
            continue;
        }

        let next = is_inside(app, state.inner());

        // When the panel is expanded, automatically collapse back to idle
        // if the user clicks anywhere outside the box.
        #[cfg(windows)]
        {
            // SAFETY: GetAsyncKeyState takes a virtual key code int and queries the OS asynchronous key state.
            let lbutton = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
            let rbutton = unsafe { GetAsyncKeyState(VK_RBUTTON.0 as i32) } < 0;
            let mbutton = unsafe { GetAsyncKeyState(VK_MBUTTON.0 as i32) } < 0;
            let is_down = lbutton || rbutton || mbutton;

            let current_notch_state = state.inner().notch_state();
            if current_notch_state == NotchState::Expanded && !next && is_down && !was_mouse_down {
                // User initiated a click outside the expanded panel: auto-collapse.
                let _ = crate::commands::apply_notch_state(app, NotchState::Idle);
            }

            was_mouse_down = is_down;
        }

        if next == inside {
            continue;
        }
        inside = next;

        if let Err(err) = window.set_ignore_cursor_events(!inside) {
            tracing::warn!("failed to update click-through: {err}");
        }
        if let Err(err) = app.emit_to("notch", "notch://hover", HoverEvent { inside }) {
            tracing::warn!("failed to emit hover event: {err}");
        }
    }
}

fn is_inside<R: Runtime>(app: &AppHandle<R>, state: &AppState) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let Some(window) = app.get_webview_window("notch") else {
        return false;
    };
    let Ok(origin) = window.outer_position() else {
        return false;
    };
    let scale = window.scale_factor().unwrap_or(1.0);

    if state.concealed() {
        let width = NotchState::Idle.pill_size().0 * scale;
        let left = origin.x as f64 + (LOGICAL_WIDTH * scale - width) / 2.0;
        let top = origin.y as f64 + PILL_TOP * scale;
        let bottom = top + REVEAL_STRIP * scale;
        return (left..=left + width).contains(&cursor.x) && (top..=bottom).contains(&cursor.y);
    }

    // The answer chip and dynamic idle activities report their measured footprint
    // via set_answer_size. For Peek and Expanded, footprints follow the state table.
    let (pill_width, pill_height) = match state.notch_state() {
        NotchState::Answer => state.answer_size(),
        NotchState::Idle => {
            let (aw, ah) = state.answer_size();
            if ah > 0.0 && aw > 0.0 {
                (aw, ah)
            } else {
                NotchState::Idle.pill_size()
            }
        }
        other => other.pill_size(),
    };
    let margin = HOVER_MARGIN * scale;

    let left = origin.x as f64 + (LOGICAL_WIDTH - pill_width) / 2.0 * scale - margin;
    let top = origin.y as f64 + PILL_TOP * scale - margin;
    let right = left + pill_width * scale + margin * 2.0;
    let bottom = top + pill_height * scale + margin * 2.0;

    (left..=right).contains(&cursor.x) && (top..=bottom).contains(&cursor.y)
}
