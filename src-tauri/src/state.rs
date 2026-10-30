//! Process-wide state shared by the notch window, tray, and commands.
//! Visual sizes mirror `src/stores/useNotchStore.ts` and `tauri.conf.json`.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};

/// Opacity is clamped to this range; below 30% the pill becomes unusable.
pub const MIN_OPACITY: u8 = 30;
pub const MAX_OPACITY: u8 = 100;
pub const DEFAULT_OPACITY: u8 = MAX_OPACITY;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum NotchState {
    #[default]
    Idle,
    Peek,
    Expanded,
    /// A compact answer pill whose size follows its content; the frontend
    /// reports the measured size via `set_answer_size`.
    Answer,
}

impl NotchState {
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::Idle => 0,
            Self::Peek => 1,
            Self::Expanded => 2,
            Self::Answer => 3,
        }
    }

    pub const fn from_u8(raw: u8) -> Self {
        match raw {
            1 => Self::Peek,
            2 => Self::Expanded,
            3 => Self::Answer,
            _ => Self::Idle,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Peek => "peek",
            Self::Expanded => "expanded",
            Self::Answer => "answer",
        }
    }

    /// Logical pill footprint. Keep in sync with `src/stores/useNotchStore.ts`.
    pub const fn pill_size(self) -> (f64, f64) {
        match self {
            Self::Idle => (320.0, 36.0),
            Self::Peek => (480.0, 72.0),
            Self::Expanded => (560.0, 420.0),
            // Initial guess while the answer chip has not been measured yet.
            Self::Answer => (180.0, 44.0),
        }
    }
}

/// Shared flags. Atomics keep the polling threads lock-free.
#[derive(Debug)]
pub struct AppState {
    visible_in_capture: AtomicBool,
    panic: AtomicBool,
    opacity: AtomicU8,
    notch_state: AtomicU8,
    settings_was_visible: AtomicBool,
    /// Measured size of the answer chip (logical px). The hover thread needs
    /// the real footprint, which only the frontend knows.
    answer_width: AtomicU32,
    answer_height: AtomicU32,
    /// Auto-hide has tucked the pill above the screen edge; the hover thread
    /// then only watches a thin strip so the top of other apps stays clickable.
    concealed: AtomicBool,
}

/// Chip size clamp: the window is 640x480 logical and the chip sits flush
/// with the screen top.
const MIN_CHIP_W: u32 = 160;
const MIN_CHIP_H: u32 = 32;
const MAX_CHIP_W: u32 = 640;
const MAX_CHIP_H: u32 = 480;

impl Default for AppState {
    fn default() -> Self {
        Self {
            // AGENTS.md rule 2: capture visibility never survives a restart.
            visible_in_capture: AtomicBool::new(false),
            panic: AtomicBool::new(false),
            opacity: AtomicU8::new(DEFAULT_OPACITY),
            notch_state: AtomicU8::new(NotchState::Idle.as_u8()),
            settings_was_visible: AtomicBool::new(false),
            answer_width: AtomicU32::new(NotchState::Answer.pill_size().0 as u32),
            answer_height: AtomicU32::new(NotchState::Answer.pill_size().1 as u32),
            concealed: AtomicBool::new(false),
        }
    }
}

impl AppState {
    pub fn visible_in_capture(&self) -> bool {
        self.visible_in_capture.load(Ordering::Relaxed)
    }

    pub fn set_visible_in_capture(&self, visible: bool) {
        self.visible_in_capture.store(visible, Ordering::Relaxed);
    }

    pub fn panic_active(&self) -> bool {
        self.panic.load(Ordering::Relaxed)
    }

    pub fn set_panic(&self, active: bool) {
        self.panic.store(active, Ordering::Relaxed);
    }

    pub fn opacity(&self) -> u8 {
        self.opacity.load(Ordering::Relaxed)
    }

    /// Clamps to [`MIN_OPACITY`]..=[`MAX_OPACITY`] and returns the stored value.
    pub fn set_opacity(&self, opacity: u8) -> u8 {
        let clamped = opacity.clamp(MIN_OPACITY, MAX_OPACITY);
        self.opacity.store(clamped, Ordering::Relaxed);
        clamped
    }

    pub fn notch_state(&self) -> NotchState {
        NotchState::from_u8(self.notch_state.load(Ordering::Relaxed))
    }

    pub fn set_notch_state(&self, state: NotchState) {
        self.notch_state.store(state.as_u8(), Ordering::Relaxed);
    }

    /// Remembers whether settings was open before panic hid everything, so the
    /// panic toggle can restore the exact previous window set.
    pub fn settings_was_visible(&self) -> bool {
        self.settings_was_visible.load(Ordering::Relaxed)
    }

    pub fn set_settings_was_visible(&self, visible: bool) {
        self.settings_was_visible.store(visible, Ordering::Relaxed);
    }

    pub fn concealed(&self) -> bool {
        self.concealed.load(Ordering::Relaxed)
    }

    pub fn set_concealed(&self, concealed: bool) {
        self.concealed.store(concealed, Ordering::Relaxed);
    }

    /// Size of the answer chip, in logical pixels.
    pub fn answer_size(&self) -> (f64, f64) {
        (
            self.answer_width.load(Ordering::Relaxed) as f64,
            self.answer_height.load(Ordering::Relaxed) as f64,
        )
    }

    /// Records a newly measured chip size from the frontend, clamped to the
    /// window bounds. Disregarded outside the answer state by the hover thread.
    pub fn set_answer_size(&self, width: u32, height: u32) {
        self.answer_width
            .store(width.clamp(MIN_CHIP_W, MAX_CHIP_W), Ordering::Relaxed);
        self.answer_height
            .store(height.clamp(MIN_CHIP_H, MAX_CHIP_H), Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_safe() {
        let state = AppState::default();
        assert!(!state.visible_in_capture());
        assert!(!state.panic_active());
        assert_eq!(state.opacity(), MAX_OPACITY);
        assert_eq!(state.notch_state(), NotchState::Idle);
        assert!(!state.settings_was_visible());
        assert!(!state.concealed());
    }

    #[test]
    fn opacity_is_clamped() {
        let state = AppState::default();
        assert_eq!(state.set_opacity(0), MIN_OPACITY);
        assert_eq!(state.set_opacity(255), MAX_OPACITY);
        assert_eq!(state.set_opacity(55), 55);
    }

    #[test]
    fn notch_state_round_trips() {
        for state in [NotchState::Idle, NotchState::Peek, NotchState::Expanded] {
            assert_eq!(NotchState::from_u8(state.as_u8()), state);
        }
        assert_eq!(NotchState::from_u8(9), NotchState::Idle);
    }

    #[test]
    fn pill_sizes_match_frontend() {
        assert_eq!(NotchState::Idle.pill_size(), (320.0, 36.0));
        assert_eq!(NotchState::Peek.pill_size(), (480.0, 72.0));
        assert_eq!(NotchState::Expanded.pill_size(), (560.0, 420.0));
    }

    #[test]
    fn answer_state_round_trips_and_size_clamps() {
        assert_eq!(
            NotchState::from_u8(NotchState::Answer.as_u8()),
            NotchState::Answer
        );

        let state = AppState::default();
        state.set_answer_size(10_000, 0);
        assert_eq!(state.answer_size(), (640.0, 32.0));
        state.set_answer_size(400, 220);
        assert_eq!(state.answer_size(), (400.0, 220.0));
    }
}
