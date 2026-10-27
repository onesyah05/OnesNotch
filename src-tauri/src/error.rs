//! Error type returned by every Tauri command.
//! Serializes to `{ code, message }`; the frontend maps `code` to an i18n string
//! (`errors.<code>` in `src/i18n/*.json`).

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("no API key saved for this provider")]
    NoKey,
    #[error("invalid API key")]
    InvalidKey,
    #[error("provider quota or rate limit exceeded")]
    Quota,
    #[error("provider is overloaded")]
    Busy,
    #[error("model not found")]
    ModelNotFound,
    #[error("this model does not accept images")]
    NoVision,
    #[error("network unavailable")]
    Offline,
    #[error("request timed out")]
    Timeout,
    #[error("{0}")]
    Provider(String),
    #[error("screen capture failed: {0}")]
    CaptureFailed(String),
    #[error("the answer session has expired")]
    SessionExpired,
    #[error("an answer is already streaming")]
    InProgress,
    #[error("paused by panic hide")]
    Paused,
    #[error("{0}")]
    InvalidInput(String),
    #[error("hotkey is unavailable: {0}")]
    HotkeyUnavailable(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoKey => "no_key",
            Self::InvalidKey => "invalid_key",
            Self::Quota => "quota",
            Self::Busy => "busy",
            Self::ModelNotFound => "model_not_found",
            Self::NoVision => "no_vision",
            Self::Offline => "offline",
            Self::Timeout => "timeout",
            Self::Provider(_) => "provider",
            Self::CaptureFailed(_) => "capture_failed",
            Self::SessionExpired => "session_expired",
            Self::InProgress => "in_progress",
            Self::Paused => "paused",
            Self::InvalidInput(_) => "invalid_input",
            Self::HotkeyUnavailable(_) => "hotkey_unavailable",
            Self::Storage(_) => "storage",
            Self::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_code_and_message() {
        let json = serde_json::to_value(AppError::CaptureFailed("no output".into())).unwrap();
        assert_eq!(json["code"], "capture_failed");
        assert_eq!(json["message"], "screen capture failed: no output");
    }

    #[test]
    fn provider_error_keeps_its_message() {
        let json = serde_json::to_value(AppError::Provider("bad request".into())).unwrap();
        assert_eq!(json["code"], "provider");
        assert_eq!(json["message"], "bad request");
    }
}
