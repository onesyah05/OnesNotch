//! Local persistence: API keys in Windows Credential Manager (`keys`),
//! settings via tauri-plugin-store (`settings`), and text-only answer
//! history in SQLite (`db`).

pub(crate) mod db;
pub(crate) mod keys;
pub(crate) mod settings;
