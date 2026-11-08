//! OAuth tokens in Windows Credential Manager (AGENTS.md rule 5).
//!
//! Tokens are read only in Rust, right before a request. Nothing here returns
//! a token to the webview, and errors never include token material. The
//! stored value is one JSON blob holding the access/refresh tokens, the
//! expiry and an optional account label.
//!
//! Windows caps one credential at 2560 bytes and the store writes UTF-16, so
//! a single entry holds about 1280 characters. A Codex login (long JWTs) is
//! several times that, so long blobs are split: the main entry then holds
//! `chunked:<n>` and the pieces live in `oauth:<id>:<i>`. Short logins keep the
//! single-entry layout, so existing sign-ins still load.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use keyring_core::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

use crate::ai::ProviderId;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.notch.app";
/// Refresh tokens can be long; allow generous room.
const MAX_TOKEN_LEN: usize = 8192;
/// Characters per credential entry: 1200 UTF-16 code units = 2400 bytes,
/// under the 2560-byte `CRED_MAX_CREDENTIAL_BLOB_SIZE`.
const CHUNK_CHARS: usize = 1200;
/// Upper bound on pieces, so a corrupt marker cannot trigger a long loop.
const MAX_CHUNKS: usize = 32;
const CHUNK_MARKER: &str = "chunked:";

/// Installs nothing; the shared credential store is set up by `keys::init`.
/// Kept as a free function so callers do not need to know the store is shared.
fn entry(id: ProviderId) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("oauth:{}", id.as_str())).map_err(|err| storage_error(&err))
}

fn chunk_entry(id: ProviderId, index: usize) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("oauth:{}:{index}", id.as_str()))
        .map_err(|err| storage_error(&err))
}

fn storage_error(err: &KeyringError) -> AppError {
    let text = match err {
        KeyringError::NoStorageAccess(_) => "credential store is locked",
        KeyringError::PlatformFailure(_) => "credential store failed",
        KeyringError::NoDefaultStore => "credential store is not initialized",
        KeyringError::NoEntry => "no saved login",
        KeyringError::TooLong(..) => "login is too large for the credential store",
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

/// Splits `raw` into pieces of at most [`CHUNK_CHARS`] characters.
fn split_chunks(raw: &str) -> Vec<String> {
    let chars: Vec<char> = raw.chars().collect();
    chars
        .chunks(CHUNK_CHARS)
        .map(|piece| piece.iter().collect())
        .collect()
}

/// The piece count a `chunked:<n>` marker announces, if `value` is one.
fn chunk_count(value: &str) -> Option<usize> {
    value
        .strip_prefix(CHUNK_MARKER)?
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=MAX_CHUNKS).contains(n))
}

fn read_main(id: ProviderId) -> AppResult<Option<String>> {
    match entry(id)?.get_password() {
        Ok(raw) => Ok(Some(raw)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(storage_error(&err)),
    }
}

/// Loads the stored tokens for `id`, or `None` when the user is not signed in.
pub fn load_tokens(id: ProviderId) -> AppResult<Option<OAuthTokens>> {
    let Some(main) = read_main(id)? else {
        return Ok(None);
    };
    let raw = match chunk_count(&main) {
        Some(count) => {
            let mut joined = String::new();
            for index in 0..count {
                let piece = chunk_entry(id, index)?
                    .get_password()
                    .map_err(|_| AppError::Storage("stored login is corrupt".into()))?;
                joined.push_str(&piece);
            }
            joined
        }
        None => main,
    };
    let tokens = serde_json::from_str::<OAuthTokens>(&raw)
        .map_err(|_| AppError::Storage("stored login is corrupt".into()))?;
    Ok(Some(tokens))
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
    let previous = read_main(id)?.as_deref().and_then(chunk_count).unwrap_or(0);

    let pieces = split_chunks(&raw);
    if pieces.len() > MAX_CHUNKS {
        return Err(AppError::InvalidInput("token too large".into()));
    }
    let main = if pieces.len() <= 1 {
        raw
    } else {
        // Pieces first, marker last, so the marker never announces pieces
        // that were not written.
        for (index, piece) in pieces.iter().enumerate() {
            chunk_entry(id, index)?
                .set_password(piece)
                .map_err(|err| storage_error(&err))?;
        }
        format!("{CHUNK_MARKER}{}", pieces.len())
    };
    entry(id)?
        .set_password(&main)
        .map_err(|err| storage_error(&err))?;

    // Drop pieces a longer earlier login left behind.
    let kept = if pieces.len() <= 1 { 0 } else { pieces.len() };
    delete_chunks(id, kept, previous);
    Ok(())
}

/// Best-effort removal of pieces `from..to`.
fn delete_chunks(id: ProviderId, from: usize, to: usize) {
    for index in from..to {
        if let Ok(entry) = chunk_entry(id, index) {
            match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => {}
                Err(err) => tracing::warn!("failed to remove a stale login piece: {err}"),
            }
        }
    }
}

/// Removes the stored login for `id`.
pub fn delete_tokens(id: ProviderId) -> AppResult<()> {
    let pieces = read_main(id)?.as_deref().and_then(chunk_count).unwrap_or(0);
    delete_chunks(id, 0, pieces);
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
    fn long_logins_split_into_entries_that_fit() {
        let raw = "x".repeat(CHUNK_CHARS * 3 + 7);
        let pieces = split_chunks(&raw);
        assert_eq!(pieces.len(), 4);
        assert!(pieces.iter().all(|p| p.encode_utf16().count() * 2 <= 2560));
        assert_eq!(pieces.concat(), raw);
        assert_eq!(split_chunks("{}").len(), 1);
    }

    #[test]
    fn chunk_markers_are_bounded() {
        assert_eq!(chunk_count("chunked:4"), Some(4));
        assert_eq!(chunk_count("chunked:0"), None);
        assert_eq!(chunk_count("chunked:9999"), None);
        assert_eq!(chunk_count("{\"accessToken\":\"a\"}"), None);
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
