//! Global media controls via Windows SMTC (`smtc.rs`). PLAN.md Phase 4.

pub mod smtc;

pub use smtc::{MediaAction, MediaManager, MediaState, spawn_media_listener};
