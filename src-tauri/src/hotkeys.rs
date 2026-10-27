//! Global hotkeys (tauri-plugin-global-shortcut). Defaults are listed in PRD.md §6;
//! users can rebind them in Settings.
//!
//! Accelerators are stored as `Ctrl+Alt+Shift+Super+<Code>` (for example
//! `Ctrl+Shift+KeyW`), the W3C key code format the plugin parses back.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{
    ai::session::AiState,
    capture::CaptureTarget,
    commands,
    error::{AppError, AppResult},
    state::{AppState, NotchState},
    storage::settings::SettingsState,
};

/// Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyAction {
    AnswerScreen,
    AnswerWindow,
    Cancel,
    ToggleExpand,
    Panic,
    ToggleCapture,
}

impl HotkeyAction {
    pub const ALL: [Self; 6] = [
        Self::AnswerScreen,
        Self::AnswerWindow,
        Self::Cancel,
        Self::ToggleExpand,
        Self::Panic,
        Self::ToggleCapture,
    ];

    pub const fn default_accelerator(self) -> &'static str {
        match self {
            Self::AnswerScreen => "Ctrl+Shift+Space",
            Self::AnswerWindow => "Ctrl+Shift+KeyW",
            // Rarely bound by other apps, unlike most Ctrl+Shift+letter combos.
            Self::Cancel => "Ctrl+Shift+Backspace",
            Self::ToggleExpand => "Ctrl+Shift+KeyN",
            Self::Panic => "Ctrl+Shift+KeyH",
            Self::ToggleCapture => "Ctrl+Shift+KeyV",
        }
    }
}

/// Payload of `ai://trigger`. Mirrored in `src/lib/ipc.ts`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TriggerEvent {
    target: CaptureTarget,
}

/// The shortcuts currently assigned, plus whether they are paused while the
/// settings window records a new combo.
#[derive(Default)]
pub struct HotkeyState {
    bound: Mutex<HashMap<HotkeyAction, Shortcut>>,
    suspended: AtomicBool,
}

/// Parses and validates an accelerator, returning the shortcut and its
/// canonical string.
pub fn parse(accelerator: &str) -> AppResult<(Shortcut, String)> {
    let shortcut: Shortcut = accelerator
        .trim()
        .parse()
        .map_err(|_| AppError::InvalidInput("invalid hotkey".into()))?;
    // Shift alone would steal capital letters from every text field.
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(AppError::InvalidInput(
            "hotkey needs Ctrl, Alt or Win".into(),
        ));
    }
    Ok((shortcut, canonical(&shortcut)))
}

fn canonical(shortcut: &Shortcut) -> String {
    let mut parts = Vec::with_capacity(5);
    for (modifier, name) in [
        (Modifiers::CONTROL, "Ctrl"),
        (Modifiers::ALT, "Alt"),
        (Modifiers::SHIFT, "Shift"),
        (Modifiers::SUPER, "Super"),
    ] {
        if shortcut.mods.contains(modifier) {
            parts.push(name.to_owned());
        }
    }
    parts.push(shortcut.key.to_string());
    parts.join("+")
}

/// Registers every hotkey from settings. A shortcut another app already owns
/// is logged and skipped so one conflict cannot disable the rest.
pub(crate) fn register_all<R: Runtime>(app: &AppHandle<R>) {
    let hotkeys = app.state::<SettingsState>().get().hotkeys;
    for action in HotkeyAction::ALL {
        let shortcut = parse(hotkeys.get(action))
            .or_else(|_| parse(action.default_accelerator()))
            .map(|(shortcut, _)| shortcut);
        match shortcut {
            Ok(shortcut) => {
                if let Err(err) = bind(app, action, shortcut) {
                    tracing::warn!("failed to register hotkey for {action:?}: {err}");
                }
            }
            Err(err) => tracing::warn!("no usable hotkey for {action:?}: {err}"),
        }
    }
}

fn bind<R: Runtime>(app: &AppHandle<R>, action: HotkeyAction, shortcut: Shortcut) -> AppResult<()> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                dispatch(app, action);
            }
        })
        .map_err(|err| AppError::HotkeyUnavailable(err.to_string()))?;
    if let Ok(mut bound) = app.state::<HotkeyState>().bound.lock() {
        bound.insert(action, shortcut);
    }
    Ok(())
}

fn unbind<R: Runtime>(app: &AppHandle<R>, shortcut: Shortcut) {
    if let Err(err) = app.global_shortcut().unregister(shortcut) {
        tracing::debug!("failed to unregister hotkey: {err}");
    }
}

/// Moves `action` to a new accelerator and saves it. On failure the old
/// binding stays active.
pub(crate) fn rebind<R: Runtime>(
    app: &AppHandle<R>,
    action: HotkeyAction,
    accelerator: &str,
) -> AppResult<String> {
    let (shortcut, canonical) = parse(accelerator)?;
    let state = app.state::<HotkeyState>();
    // Rebinding ends a recording session, so make sure everything is live again.
    suspend(app, false);

    let old = {
        let bound = state
            .bound
            .lock()
            .map_err(|_| AppError::Internal("hotkey lock poisoned".into()))?;
        if bound
            .iter()
            .any(|(other, existing)| *other != action && existing.id() == shortcut.id())
        {
            return Err(AppError::InvalidInput(
                "already used by another Notch hotkey".into(),
            ));
        }
        bound.get(&action).copied()
    };

    if old.is_some_and(|old| old.id() == shortcut.id()) {
        return Ok(canonical);
    }
    if let Some(old) = old {
        unbind(app, old);
    }
    if let Err(err) = bind(app, action, shortcut) {
        if let Some(old) = old
            && let Err(restore) = bind(app, action, old)
        {
            tracing::warn!("failed to restore hotkey for {action:?}: {restore}");
        }
        return Err(err);
    }

    let saved = app.state::<SettingsState>().update(app, |settings| {
        settings.hotkeys.set(action, canonical.clone());
        Ok(())
    });
    if let Err(err) = saved {
        tracing::warn!("hotkey changed but could not be saved: {err}");
    }
    Ok(canonical)
}

/// Pauses every hotkey while the settings window records a combo, so pressing
/// an existing combo does not fire it.
pub(crate) fn suspend<R: Runtime>(app: &AppHandle<R>, suspended: bool) {
    let state = app.state::<HotkeyState>();
    if state.suspended.swap(suspended, Ordering::SeqCst) == suspended {
        return;
    }
    let bound: Vec<(HotkeyAction, Shortcut)> = state
        .bound
        .lock()
        .map(|bound| bound.iter().map(|(a, s)| (*a, *s)).collect())
        .unwrap_or_default();
    for (action, shortcut) in bound {
        if suspended {
            unbind(app, shortcut);
        } else if let Err(err) = bind(app, action, shortcut) {
            tracing::warn!("failed to resume hotkey for {action:?}: {err}");
        }
    }
}

fn dispatch<R: Runtime>(app: &AppHandle<R>, action: HotkeyAction) {
    let state = app.state::<AppState>();
    if action == HotkeyAction::Panic {
        if let Err(err) = commands::apply_panic_toggle(app) {
            tracing::warn!("panic hotkey failed: {err}");
        }
        return;
    }
    // Everything else stays inert while hidden (rule 7).
    if state.panic_active() {
        return;
    }

    let result = match action {
        HotkeyAction::AnswerScreen => trigger_answer(app, CaptureTarget::Screen),
        HotkeyAction::AnswerWindow => trigger_answer(app, CaptureTarget::Window),
        HotkeyAction::Cancel => {
            app.state::<AiState>().cancel_current();
            Ok(())
        }
        HotkeyAction::ToggleExpand => {
            let next = if state.notch_state() == NotchState::Expanded {
                NotchState::Idle
            } else {
                NotchState::Expanded
            };
            commands::apply_notch_state(app, next)
        }
        HotkeyAction::ToggleCapture => {
            commands::apply_capture_visibility(app, !state.visible_in_capture())
        }
        HotkeyAction::Panic => Ok(()),
    };
    if let Err(err) = result {
        tracing::warn!("hotkey {action:?} failed: {err}");
    }
}

/// Pressing an answer hotkey while an answer streams cancels it (PRD A-6).
/// Otherwise the notch opens and the frontend starts the request, since only
/// it can create the streaming channel.
fn trigger_answer<R: Runtime>(app: &AppHandle<R>, target: CaptureTarget) -> AppResult<()> {
    if app.state::<AiState>().cancel_current() {
        return Ok(());
    }
    // Do not open the wide panel: the frontend shows a compact answer chip
    // that grows with the answer, and only expands on click.
    commands::apply_notch_state(app, NotchState::Answer)?;
    app.emit_to("notch", "ai://trigger", TriggerEvent { target })
        .map_err(|err| AppError::Internal(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_parse_and_are_canonical() {
        for action in HotkeyAction::ALL {
            let accelerator = action.default_accelerator();
            let (_, canonical) = parse(accelerator).unwrap();
            assert_eq!(canonical, accelerator, "{action:?}");
        }
    }

    #[test]
    fn defaults_do_not_collide() {
        let mut ids: Vec<u32> = HotkeyAction::ALL
            .iter()
            .map(|action| parse(action.default_accelerator()).unwrap().0.id())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), HotkeyAction::ALL.len());
    }

    #[test]
    fn normalizes_aliases_and_order() {
        assert_eq!(parse("shift+control+a").unwrap().1, "Ctrl+Shift+KeyA");
        assert_eq!(parse("Alt+Super+F5").unwrap().1, "Alt+Super+F5");
        assert_eq!(parse("ctrl+1").unwrap().1, "Ctrl+Digit1");
    }

    #[test]
    fn rejects_unsafe_or_invalid_combos() {
        assert!(parse("Shift+KeyA").is_err(), "would steal typing");
        assert!(parse("KeyA").is_err());
        assert!(parse("Ctrl+Shift").is_err());
        assert!(parse("Ctrl+Nope").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn actions_serialize_as_camel_case() {
        assert_eq!(
            serde_json::to_value(HotkeyAction::AnswerScreen).unwrap(),
            "answerScreen"
        );
    }
}
