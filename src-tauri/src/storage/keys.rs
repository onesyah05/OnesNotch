//! API keys in Windows Credential Manager (AGENTS.md rule 5).
//!
//! Keys are read only in Rust, right before a request. Nothing here returns a
//! key to the webview, and errors never include key material.

use keyring_core::{Entry, Error as KeyringError};

use crate::ai::ProviderId;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.notch.app";
const MAX_KEY_LEN: usize = 512;

/// Installs the Windows credential store. Call once at startup.
pub fn init() {
    #[cfg(windows)]
    match windows_native_keyring_store::Store::new() {
        Ok(store) => keyring_core::set_default_store(store),
        Err(err) => tracing::error!("credential store unavailable: {}", describe(&err)),
    }
}

/// Error text without any payload the keyring error might carry.
fn describe(err: &KeyringError) -> &'static str {
    match err {
        KeyringError::NoStorageAccess(_) => "credential store is locked",
        KeyringError::PlatformFailure(_) => "credential store failed",
        KeyringError::NoDefaultStore => "credential store is not initialized",
        KeyringError::NoEntry => "no saved key",
        _ => "credential store error",
    }
}

fn storage_error(err: &KeyringError) -> AppError {
    AppError::Storage(describe(err).into())
}

fn entry(id: ProviderId) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("api-key:{}", id.as_str())).map_err(|err| storage_error(&err))
}

pub fn get(id: ProviderId) -> AppResult<Option<String>> {
    match entry(id)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(storage_error(&err)),
    }
}

pub fn has(id: ProviderId) -> bool {
    matches!(get(id), Ok(Some(_)))
}

pub fn set(id: ProviderId, raw: &str) -> AppResult<()> {
    let key = validate(raw)?;
    entry(id)?
        .set_password(&key)
        .map_err(|err| storage_error(&err))
}

pub fn delete(id: ProviderId) -> AppResult<()> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(storage_error(&err)),
    }
}

/// Keys are opaque tokens: printable ASCII, no spaces.
pub fn validate(raw: &str) -> AppResult<String> {
    let key = raw.trim();
    if key.is_empty() || key.len() > MAX_KEY_LEN || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err(AppError::InvalidInput("invalid API key format".into()));
    }
    Ok(key.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_key_shape() {
        assert_eq!(validate("  sk-ant-abc123 \n").unwrap(), "sk-ant-abc123");
        assert!(validate("").is_err());
        assert!(validate("has space").is_err());
        assert!(validate("ünïcode").is_err());
        assert!(validate(&"x".repeat(MAX_KEY_LEN + 1)).is_err());
    }

    #[test]
    fn errors_never_echo_the_key() {
        let err = validate("secret value").unwrap_err();
        assert!(!err.to_string().contains("secret"));
    }
}
