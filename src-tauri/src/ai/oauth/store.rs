//! OAuth tokens in Windows Credential Manager (AGENTS.md rule 5).
//!
//! Tokens are read only in Rust, right before a request. Nothing here returns
//! a token to the webview, and errors never include token material. The
//! keyring value is one JSON blob holding the access/refresh tokens, the
//! expiry and an optional account label.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use keyring_core::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

use crate::ai::ProviderId;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.notch.app";
/// Refresh tokens can be long; allow generous room.
const MAX_TOKEN_LEN: usize = 8192;

/// Installs nothing; the shared credential store is set up by `keys::init`.
/// Kept as a free function so callers do not need to know the store is shared.
fn entry(id: ProviderId) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("oauth:{}", id.as_str())).map_err(|err| storage_error(&err))
}

fn storage_error(err: &KeyringError) -> AppError {
    let text = match err {
        KeyringError::NoStorageAccess(_) => "credential store is locked",
        KeyringError::PlatformFailure(_) => "credential store failed",
        KeyringError::NoDefaultStore => "credential store is not initialized",
        KeyringError::NoEntry => "no saved login",
        _ => "credential store error",
    };
    AppError::Storage(text.into())
}

/// One provider's persisted OAuth tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix seconds at which the access token expires.
    pub expires_at: u64,
    pub account_label: Option<String>,
}

impl OAuthTokens {
    /// Whether the access token is at or past `margin` from expiring.
    pub fn needs_refresh(&self, margin: Duration) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        now + margin.as_secs() >= self.expires_at
    }
}

/// Loads the stored tokens for `id`, or `None` when the user is not signed in.
pub fn load_tokens(id: ProviderId) -> AppResult<Option<OAuthTokens>> {
    match entry(id)?.get_password() {
        Ok(raw) => {
            let tokens = serde_json::from_str::<OAuthTokens>(&raw)
                .map_err(|_| AppError::Storage("stored login is corrupt".into()))?;
            Ok(Some(tokens))
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(storage_error(&err)),
    }
}

/// Whether `id` has a stored subscription login.
pub fn has_tokens(id: ProviderId) -> bool {
    matches!(load_tokens(id), Ok(Some(_)))
}

/// Persists `tokens` for `id`.
pub fn save_tokens(id: ProviderId, tokens: &OAuthTokens) -> AppResult<()> {
    if tokens.access_token.len() > MAX_TOKEN_LEN {
        return Err(AppError::InvalidInput("token too large".into()));
    }
    let raw =
        serde_json::to_string(tokens).map_err(|_| AppError::Internal("encode failed".into()))?;
    entry(id)?
        .set_password(&raw)
        .map_err(|err| storage_error(&err))
}

/// Removes the stored login for `id`.
pub fn delete_tokens(id: ProviderId) -> AppResult<()> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(storage_error(&err)),
    }
}

/// BASE64URL without padding, as OAuth2 requires.
pub(crate) fn base64_url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_url_has_no_padding() {
        assert_eq!(
            base64_url(b"any carnal pleasure."),
            "YW55IGNhcm5hbCBwbGVhc3VyZS4"
        );
    }

    #[test]
    fn expiry_roundtrip() {
        let tokens = OAuthTokens {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: u64::MAX,
            account_label: None,
        };
        assert!(!tokens.needs_refresh(Duration::from_secs(120)));
        let expired = OAuthTokens {
            expires_at: 0,
            ..tokens
        };
        assert!(expired.needs_refresh(Duration::from_secs(120)));
    }
}
