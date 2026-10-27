//! User settings, persisted with tauri-plugin-store as one JSON document.
//!
//! Loading is lenient: a field that is missing, has the wrong type or holds an
//! unknown value falls back to its default on its own, so one bad value never
//! wipes the rest. "Visible in capture" is deliberately not a setting
//! (AGENTS.md rule 2).

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::ai::{self, ProviderId};
use crate::capture::CaptureTarget;
use crate::error::{AppError, AppResult};
use crate::hotkeys::HotkeyAction;
use crate::notifications::NotificationSettings;
use crate::state::{DEFAULT_OPACITY, MAX_OPACITY, MIN_OPACITY};

pub const VERSION: u32 = 1;
const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Default,
{
    let value = Value::deserialize(deserializer)?;
    Ok(T::deserialize(value).unwrap_or_default())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeSettings {
    pub background_color: String,
    pub accent_color: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            background_color: "#111522".to_string(),
            accent_color: "#22D3EE".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    #[serde(deserialize_with = "lenient")]
    pub ai: AiSettings,
    #[serde(deserialize_with = "lenient")]
    pub hotkeys: HotkeySettings,
    #[serde(deserialize_with = "lenient")]
    pub opacity: Opacity,
    #[serde(deserialize_with = "lenient")]
    pub notifications: NotificationSettings,
    #[serde(deserialize_with = "lenient")]
    pub theme: ThemeSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            ai: AiSettings::default(),
            hotkeys: HotkeySettings::default(),
            opacity: Opacity::default(),
            notifications: NotificationSettings::default(),
            theme: ThemeSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Opacity(pub u8);

impl Default for Opacity {
    fn default() -> Self {
        Self(DEFAULT_OPACITY)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiSettings {
    #[serde(deserialize_with = "lenient")]
    pub provider: ProviderId,
    /// Target used by the panel's "answer" button.
    #[serde(deserialize_with = "lenient")]
    pub capture_mode: CaptureTarget,
    #[serde(deserialize_with = "lenient")]
    pub history_enabled: HistoryEnabled,
    #[serde(deserialize_with = "lenient")]
    pub providers: BTreeMap<ProviderId, ProviderPrefs>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HistoryEnabled(pub bool);

impl Default for HistoryEnabled {
    fn default() -> Self {
        Self(true)
    }
}

/// Per-provider overrides. `None` means "use the provider default".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderPrefs {
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "lenient")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "lenient")]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HotkeySettings {
    #[serde(deserialize_with = "lenient")]
    pub answer_screen: String,
    #[serde(deserialize_with = "lenient")]
    pub answer_window: String,
    #[serde(deserialize_with = "lenient")]
    pub cancel: String,
    #[serde(deserialize_with = "lenient")]
    pub toggle_expand: String,
    #[serde(deserialize_with = "lenient")]
    pub panic: String,
    #[serde(deserialize_with = "lenient")]
    pub toggle_capture: String,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        let mut hotkeys = Self {
            answer_screen: String::new(),
            answer_window: String::new(),
            cancel: String::new(),
            toggle_expand: String::new(),
            panic: String::new(),
            toggle_capture: String::new(),
        };
        for action in HotkeyAction::ALL {
            hotkeys.set(action, action.default_accelerator().to_owned());
        }
        hotkeys
    }
}

impl HotkeySettings {
    pub fn get(&self, action: HotkeyAction) -> &str {
        match action {
            HotkeyAction::AnswerScreen => &self.answer_screen,
            HotkeyAction::AnswerWindow => &self.answer_window,
            HotkeyAction::Cancel => &self.cancel,
            HotkeyAction::ToggleExpand => &self.toggle_expand,
            HotkeyAction::Panic => &self.panic,
            HotkeyAction::ToggleCapture => &self.toggle_capture,
        }
    }

    pub fn set(&mut self, action: HotkeyAction, accelerator: String) {
        let slot = match action {
            HotkeyAction::AnswerScreen => &mut self.answer_screen,
            HotkeyAction::AnswerWindow => &mut self.answer_window,
            HotkeyAction::Cancel => &mut self.cancel,
            HotkeyAction::ToggleExpand => &mut self.toggle_expand,
            HotkeyAction::Panic => &mut self.panic,
            HotkeyAction::ToggleCapture => &mut self.toggle_capture,
        };
        *slot = accelerator;
    }
}

impl Settings {
    /// Parses a stored document (any version) into current settings.
    pub fn from_value(value: Value) -> Self {
        let mut settings: Self = serde_json::from_value(value).unwrap_or_default();
        settings.normalize();
        settings
    }

    /// Repairs values that parsed but are out of range.
    fn normalize(&mut self) {
        // v0 (no version field) has the same shape as v1; future migrations go here.
        self.version = VERSION;
        self.opacity.0 = self.opacity.0.clamp(MIN_OPACITY, MAX_OPACITY);

        for (id, prefs) in &mut self.ai.providers {
            prefs.model = prefs
                .model
                .as_deref()
                .and_then(|model| ai::normalize_model(model).ok());
            prefs.base_url = if id.base_url_editable() {
                prefs
                    .base_url
                    .as_deref()
                    .and_then(|url| ai::normalize_base_url(url).ok())
            } else {
                None
            };
        }
        self.ai
            .providers
            .retain(|_, prefs| *prefs != ProviderPrefs::default());

        if self.theme.background_color.trim().is_empty() {
            self.theme.background_color = "#111522".to_string();
        }
        if self.theme.accent_color.trim().is_empty() {
            self.theme.accent_color = "#22D3EE".to_string();
        }

        let defaults = HotkeySettings::default();
        for action in HotkeyAction::ALL {
            if crate::hotkeys::parse(self.hotkeys.get(action)).is_err() {
                self.hotkeys.set(action, defaults.get(action).to_owned());
            }
        }
    }

    pub fn prefs(&self, id: ProviderId) -> ProviderPrefs {
        self.ai.providers.get(&id).cloned().unwrap_or_default()
    }

    pub fn model(&self, id: ProviderId) -> String {
        self.prefs(id)
            .model
            .unwrap_or_else(|| id.default_model().to_owned())
    }

    pub fn base_url(&self, id: ProviderId) -> Option<String> {
        let custom = id
            .base_url_editable()
            .then(|| self.prefs(id).base_url)
            .flatten();
        custom.or_else(|| id.default_base_url().map(str::to_owned))
    }

    pub fn update_prefs(&mut self, id: ProviderId, update: impl FnOnce(&mut ProviderPrefs)) {
        let mut prefs = self.prefs(id);
        update(&mut prefs);
        if prefs == ProviderPrefs::default() {
            self.ai.providers.remove(&id);
        } else {
            self.ai.providers.insert(id, prefs);
        }
    }
}

/// In-memory copy of the settings plus write-through persistence.
pub struct SettingsState {
    inner: Mutex<Settings>,
}

impl SettingsState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let settings = match app.store(STORE_FILE) {
            Ok(store) => store
                .get(STORE_KEY)
                .map(Settings::from_value)
                .unwrap_or_default(),
            Err(err) => {
                tracing::warn!("settings store unavailable, using defaults: {err}");
                Settings::default()
            }
        };
        Self {
            inner: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    /// Applies `change` and saves. The in-memory copy changes only if saving works.
    pub fn update<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Settings) -> AppResult<()>,
    ) -> AppResult<Settings> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("settings lock poisoned".into()))?;
        let mut next = guard.clone();
        change(&mut next)?;
        if next != *guard {
            save(app, &next)?;
            *guard = next.clone();
        }
        Ok(next)
    }
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> AppResult<()> {
    let storage = |err: &dyn std::fmt::Display| AppError::Storage(err.to_string());
    let store = app.store(STORE_FILE).map_err(|err| storage(&err))?;
    let value = serde_json::to_value(settings).map_err(|err| storage(&err))?;
    store.set(STORE_KEY, value);
    store.save().map_err(|err| storage(&err))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn defaults_follow_the_prd() {
        let settings = Settings::default();
        assert_eq!(settings.ai.provider, ProviderId::Anthropic);
        assert_eq!(settings.ai.capture_mode, CaptureTarget::Screen);
        assert!(settings.ai.history_enabled.0);
        assert_eq!(settings.opacity.0, 100);
        assert_eq!(settings.hotkeys.answer_screen, "Ctrl+Shift+Space");
        assert_eq!(settings.hotkeys.answer_window, "Ctrl+Shift+KeyW");
        assert_eq!(settings.hotkeys.panic, "Ctrl+Shift+KeyH");
        assert_eq!(settings.theme.background_color, "#111522");
        assert_eq!(settings.theme.accent_color, "#22D3EE");
    }

    #[test]
    fn round_trips() {
        let mut settings = Settings::default();
        settings.ai.provider = ProviderId::OpenaiCompatible;
        settings.update_prefs(ProviderId::OpenaiCompatible, |prefs| {
            prefs.base_url = Some("https://openrouter.ai/api/v1".into());
            prefs.model = Some("qwen/qwen3-vl".into());
        });
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["ai"]["provider"], "openai_compatible");
        assert_eq!(Settings::from_value(value), settings);
    }

    #[test]
    fn migrates_v0_documents_and_repairs_bad_fields() {
        let legacy = json!({
            "ai": {
                "provider": "skynet",
                "captureMode": "window",
                "historyEnabled": "yes",
                "providers": {
                    "openai_compatible": { "baseUrl": "ftp://bad", "model": "good-model" },
                    "anthropic": { "baseUrl": "https://evil.example.com" },
                    "ollama": { "model": "has spaces" }
                }
            },
            "hotkeys": { "panic": "Ctrl+Alt+KeyP", "cancel": "NotAKey", "answerScreen": 42 },
            "opacity": 5,
            "visibleInCapture": true,
            "somethingNew": [1, 2, 3]
        });
        let settings = Settings::from_value(legacy);

        assert_eq!(settings.version, VERSION);
        assert_eq!(
            settings.ai.provider,
            ProviderId::Anthropic,
            "unknown provider"
        );
        assert_eq!(settings.ai.capture_mode, CaptureTarget::Window, "kept");
        assert!(settings.ai.history_enabled.0, "wrong type → default");
        assert_eq!(settings.opacity.0, MIN_OPACITY, "clamped");
        assert_eq!(settings.hotkeys.panic, "Ctrl+Alt+KeyP", "kept");
        assert_eq!(
            settings.hotkeys.cancel,
            HotkeyAction::Cancel.default_accelerator()
        );
        assert_eq!(settings.hotkeys.answer_screen, "Ctrl+Shift+Space");

        let compat = settings.prefs(ProviderId::OpenaiCompatible);
        assert_eq!(compat.model.as_deref(), Some("good-model"));
        assert_eq!(compat.base_url, None, "invalid URL dropped");
        assert_eq!(
            settings.base_url(ProviderId::Anthropic).as_deref(),
            Some("https://api.anthropic.com"),
            "hosted providers ignore stored URLs"
        );
        assert_eq!(settings.model(ProviderId::Ollama), "gemma3");
        assert!(
            !settings.ai.providers.contains_key(&ProviderId::Anthropic),
            "empty prefs are pruned"
        );

        let saved = serde_json::to_value(&settings).unwrap();
        assert!(saved.get("visibleInCapture").is_none(), "rule 2");
    }

    #[test]
    fn garbage_documents_fall_back_to_defaults() {
        assert_eq!(Settings::from_value(json!("nope")), Settings::default());
        assert_eq!(Settings::from_value(Value::Null), Settings::default());
    }
}
