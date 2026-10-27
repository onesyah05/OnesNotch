//! Windows notification mirroring via `UserNotificationListener` (`listener.rs`).
//! PLAN.md Phase 5 & PRD §5.5.

pub mod listener;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppNotification {
    pub id: String,
    pub app_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    pub title: String,
    pub body: String,
    pub timestamp: u64,
    pub read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct NotificationSettings {
    pub enabled: bool,
    pub dnd_enabled: bool,
    pub auto_dismiss_seconds: u32,
    pub allowed_apps: Vec<String>,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            dnd_enabled: false,
            auto_dismiss_seconds: 5,
            allowed_apps: vec![
                "WhatsApp".into(),
                "Telegram".into(),
                "Discord".into(),
                "Slack".into(),
                "Teams".into(),
            ],
        }
    }
}
