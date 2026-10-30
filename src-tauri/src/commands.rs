use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, ipc::Channel};

use crate::{
    ai::{
        self, KeyPolicy, ProviderId,
        prompts::UiLanguage,
        session::{self, AiEvent, AiState},
    },
    capture::CaptureTarget,
    error::{AppError, AppResult},
    hotkeys::{self, HotkeyAction},
    media::{self, MediaAction, MediaManager, MediaState},
    notifications::{self, AppNotification, NotificationSettings, listener::NotificationManager},
    state::{AppState, NotchState},
    storage::{
        db::{HistoryDb, HistoryEntry},
        keys,
        settings::{
            AutoHideSettings, Autostart, HistoryEnabled, HotkeySettings, Opacity, Settings,
            SettingsState, ThemeSettings, UpdateSettings, WaterSettings,
        },
    },
    system, window,
};

/// Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub os_build: Option<u32>,
}

/// Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub visible_in_capture: bool,
    pub panic: bool,
    pub opacity: u8,
    pub state: &'static str,
}

/// Settings as the UI sees them: keys appear only as `has_key` (rule 5).
/// Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub provider: ProviderId,
    pub capture_mode: CaptureTarget,
    pub history_enabled: bool,
    pub providers: Vec<ProviderView>,
    pub hotkeys: HotkeySettings,
    pub hotkey_defaults: HotkeySettings,
    pub opacity: u8,
    pub notifications: NotificationSettings,
    pub theme: ThemeSettings,
    pub autostart: bool,
    pub auto_hide: AutoHideSettings,
    pub water: WaterSettings,
    pub updates: UpdateSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: ProviderId,
    pub key_policy: KeyPolicy,
    pub has_key: bool,
    /// The custom model, or `None` when the default is used.
    pub model: Option<String>,
    pub default_model: &'static str,
    pub base_url: Option<String>,
    pub base_url_editable: bool,
}

/// Fields the settings UI can change in one call. Missing fields stay as they are.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub provider: Option<ProviderId>,
    pub capture_mode: Option<CaptureTarget>,
    pub history_enabled: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StealthEvent {
    visible: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotchStateEvent {
    state: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpacityEvent {
    opacity: u8,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanicEvent {
    active: bool,
}

fn internal(err: impl std::fmt::Display) -> AppError {
    AppError::Internal(err.to_string())
}

fn emit<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) -> AppResult<()> {
    app.emit(event, payload).map_err(internal)
}

fn settings_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window("settings")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn hide_all<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if let Err(err) = window::stealth::hide(&window) {
            tracing::warn!("failed to hide window '{label}' during panic: {err}");
        }
    }
}

fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        tracing::warn!("window '{label}' is not configured");
        return;
    };
    if let Err(err) = window.show() {
        tracing::warn!("failed to show window '{label}': {err}");
    }
}

fn settings_view(settings: &Settings) -> SettingsView {
    let providers = ProviderId::ALL
        .into_iter()
        .map(|id| ProviderView {
            id,
            key_policy: id.key_policy(),
            has_key: id.key_policy() != KeyPolicy::None && keys::has(id),
            model: settings.prefs(id).model,
            default_model: id.default_model(),
            base_url: settings.base_url(id),
            base_url_editable: id.base_url_editable(),
        })
        .collect();
    SettingsView {
        provider: settings.ai.provider,
        capture_mode: settings.ai.capture_mode,
        history_enabled: settings.ai.history_enabled.0,
        providers,
        hotkeys: settings.hotkeys.clone(),
        hotkey_defaults: HotkeySettings::default(),
        opacity: settings.opacity.0,
        notifications: settings.notifications.clone(),
        theme: settings.theme.clone(),
        autostart: settings.autostart.0,
        auto_hide: settings.auto_hide,
        water: settings.water.clone(),
        updates: settings.updates,
    }
}

/// Tells every window that settings changed, so the notch and the settings
/// window stay in sync.
fn broadcast_settings<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> SettingsView {
    let view = settings_view(settings);
    if let Err(err) = app.emit("settings://changed", ()) {
        tracing::debug!("failed to broadcast settings: {err}");
    }
    view
}

fn update_settings<R: Runtime>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut Settings) -> AppResult<()>,
) -> AppResult<SettingsView> {
    let settings = app.state::<SettingsState>().update(app, change)?;
    Ok(broadcast_settings(app, &settings))
}

pub(crate) fn apply_notch_state<R: Runtime>(
    app: &AppHandle<R>,
    notch_state: NotchState,
) -> AppResult<()> {
    app.state::<AppState>().set_notch_state(notch_state);
    emit(
        app,
        "notch://state",
        NotchStateEvent {
            state: notch_state.as_str(),
        },
    )
}

pub(crate) fn apply_capture_visibility<R: Runtime>(
    app: &AppHandle<R>,
    visible: bool,
) -> AppResult<()> {
    app.state::<AppState>().set_visible_in_capture(visible);
    window::apply_all(app, visible);
    emit(app, "stealth://changed", StealthEvent { visible })
}

pub(crate) fn apply_panic_toggle<R: Runtime>(app: &AppHandle<R>) -> AppResult<bool> {
    let state = app.state::<AppState>();
    let active = !state.panic_active();
    state.set_panic(active);

    if active {
        state.set_settings_was_visible(settings_visible(app));
        hide_all(app);
        // Rule 7: stop the stream and drop the screenshot from memory.
        app.state::<AiState>().clear();
    } else {
        let restore_settings = state.settings_was_visible();
        state.set_settings_was_visible(false);
        show_window(app, "notch");
        if restore_settings {
            show_window(app, "settings");
        }
        window::apply_all(app, state.visible_in_capture());
    }

    emit(app, "panic://changed", PanicEvent { active })?;
    Ok(active)
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn app_info() -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: "OnesNotch",
        version: env!("CARGO_PKG_VERSION"),
        os_build: system::os_build(),
    })
}

#[tauri::command]
pub fn app_status(app_state: State<'_, AppState>) -> AppResult<AppStatus> {
    Ok(AppStatus {
        visible_in_capture: app_state.visible_in_capture(),
        panic: app_state.panic_active(),
        opacity: app_state.opacity(),
        state: app_state.notch_state().as_str(),
    })
}

#[tauri::command]
pub fn set_notch_state(app: AppHandle, state: String) -> AppResult<()> {
    let notch_state = match state.as_str() {
        "peek" => NotchState::Peek,
        "expanded" => NotchState::Expanded,
        "answer" => NotchState::Answer,
        _ => NotchState::Idle,
    };
    apply_notch_state(&app, notch_state)
}

/// Keeps the click-through rect in step with the measured answer chip.
#[tauri::command]
pub fn set_answer_size(app: AppHandle, width: u32, height: u32) -> AppResult<()> {
    app.state::<AppState>().set_answer_size(width, height);
    Ok(())
}

/// Auto-hide tucked the pill away (or brought it back); the hover thread
/// shrinks its hot area to a thin strip along the screen edge while hidden.
#[tauri::command]
pub fn set_concealed(app: AppHandle, concealed: bool) -> AppResult<()> {
    app.state::<AppState>().set_concealed(concealed);
    Ok(())
}

#[tauri::command]
pub fn set_visible_in_capture(app: AppHandle, visible: bool) -> AppResult<()> {
    apply_capture_visibility(&app, visible)
}

#[tauri::command]
pub fn set_opacity(app: AppHandle, opacity: u8) -> AppResult<u8> {
    let opacity = app.state::<AppState>().set_opacity(opacity);
    app.state::<SettingsState>().update(&app, |settings| {
        settings.opacity = Opacity(opacity);
        Ok(())
    })?;
    emit(&app, "appearance://opacity", OpacityEvent { opacity })?;
    Ok(opacity)
}

#[tauri::command]
pub fn theme_set(
    app: AppHandle,
    background_color: Option<String>,
    accent_color: Option<String>,
) -> AppResult<ThemeSettings> {
    let settings = app.state::<SettingsState>().update(&app, |settings| {
        if let Some(bg) = background_color
            && !bg.trim().is_empty()
        {
            settings.theme.background_color = bg;
        }
        if let Some(accent) = accent_color
            && !accent.trim().is_empty()
        {
            settings.theme.accent_color = accent;
        }
        Ok(())
    })?;
    emit(&app, "appearance://theme", &settings.theme)?;
    Ok(settings.theme)
}

#[tauri::command]
pub fn show_settings(app: AppHandle) -> AppResult<()> {
    // Rule 7: during panic hide nothing may surface, settings included.
    if app.state::<AppState>().panic_active() {
        return Err(AppError::Paused);
    }
    let window = match app.get_webview_window("settings") {
        Some(window) => window,
        // Hidden windows can be destroyed (e.g. after a crash); recreate so
        // "open settings" never becomes a dead button.
        None => window::recreate_settings(&app).map_err(internal)?,
    };
    let _ = window.unminimize();
    // The pill is always-on-top, so plain show/focus can leave the settings
    // window invisible behind other windows ("settings cannot be opened").
    let _ = window.set_always_on_top(true);
    window.show().map_err(internal)?;
    // Hidden windows are always capture-excluded; now that it is on screen,
    // follow the user's "visible in capture" choice again.
    let visible_in_capture = app.state::<AppState>().visible_in_capture();
    if let Err(err) = window::stealth::apply(&window, visible_in_capture) {
        tracing::error!("failed to apply stealth to settings: {err}");
    }
    window.set_focus().map_err(internal)
}

#[tauri::command]
pub fn hide_settings(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("settings") {
        window::stealth::hide(&window).map_err(internal)?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_panic(app: AppHandle) -> AppResult<bool> {
    apply_panic_toggle(&app)
}

#[tauri::command]
pub fn clipboard_write(
    manager: State<'_, std::sync::Arc<system::clipboard::ClipboardManager>>,
    text: String,
) -> AppResult<()> {
    system::clipboard::write_text(&text)?;
    manager.add_item(text);
    Ok(())
}

#[tauri::command]
pub fn get_system_stats(
    monitor: State<'_, system::stats::SystemStatsMonitor>,
) -> AppResult<system::stats::SystemStats> {
    Ok(system::stats::current_stats(&monitor))
}

// ---------------------------------------------------------------------------
// AI answers
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ai_answer(
    app: AppHandle,
    target: CaptureTarget,
    lang: UiLanguage,
    on_event: Channel<AiEvent>,
) -> AppResult<u64> {
    session::answer(&app, target, lang, on_event)
}

#[tauri::command]
pub fn ai_followup(
    app: AppHandle,
    session_id: u64,
    text: String,
    on_event: Channel<AiEvent>,
) -> AppResult<u64> {
    session::followup(&app, session_id, &text, on_event)
}

#[tauri::command]
pub fn ai_retry(app: AppHandle, session_id: u64, on_event: Channel<AiEvent>) -> AppResult<u64> {
    session::retry(&app, session_id, on_event)
}

#[tauri::command]
pub fn ai_cancel(ai: State<'_, AiState>, session_id: u64) -> AppResult<()> {
    ai.cancel(session_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn settings_get(settings: State<'_, SettingsState>) -> AppResult<SettingsView> {
    Ok(settings_view(&settings.get()))
}

#[tauri::command]
pub fn settings_update(app: AppHandle, patch: SettingsPatch) -> AppResult<SettingsView> {
    update_settings(&app, |settings| {
        if let Some(provider) = patch.provider {
            settings.ai.provider = provider;
        }
        if let Some(mode) = patch.capture_mode {
            settings.ai.capture_mode = mode;
        }
        if let Some(enabled) = patch.history_enabled {
            settings.ai.history_enabled = HistoryEnabled(enabled);
        }
        Ok(())
    })
}

/// Turns launch-with-Windows on or off. The OS entry changes first, so the
/// stored choice never claims something the registry does not reflect.
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> AppResult<SettingsView> {
    system::autostart::apply(&app, enabled)?;
    update_settings(&app, |settings| {
        settings.autostart = Autostart(enabled);
        Ok(())
    })
}

#[tauri::command]
pub fn auto_hide_update(app: AppHandle, settings: AutoHideSettings) -> AppResult<SettingsView> {
    update_settings(&app, |current| {
        current.auto_hide = settings;
        current.normalize();
        Ok(())
    })
}

#[tauri::command]
pub fn water_update(app: AppHandle, settings: WaterSettings) -> AppResult<SettingsView> {
    update_settings(&app, |current| {
        current.water = settings;
        current.normalize();
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/// Result of the last check (background or manual), if a newer version exists.
#[tauri::command]
pub fn update_status(
    updates: State<'_, system::updater::UpdateState>,
) -> AppResult<Option<system::updater::UpdateInfo>> {
    Ok(updates.available())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> AppResult<Option<system::updater::UpdateInfo>> {
    system::updater::check(&app).await
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    on_event: Channel<system::updater::UpdateEvent>,
) -> AppResult<()> {
    system::updater::install(&app, on_event).await
}

#[tauri::command]
pub fn update_set_auto_check(app: AppHandle, enabled: bool) -> AppResult<SettingsView> {
    update_settings(&app, |settings| {
        settings.updates.auto_check = enabled;
        Ok(())
    })
}

/// Sets a provider's model and/or base URL. An empty string resets to the default.
#[tauri::command]
pub fn provider_update(
    app: AppHandle,
    id: ProviderId,
    model: Option<String>,
    base_url: Option<String>,
) -> AppResult<SettingsView> {
    let model = model
        .map(|raw| match raw.trim() {
            "" => Ok(None),
            value => ai::normalize_model(value).map(Some),
        })
        .transpose()?;
    let base_url = match base_url {
        Some(_) if !id.base_url_editable() => {
            return Err(AppError::InvalidInput(
                "this provider's URL cannot be changed".into(),
            ));
        }
        Some(raw) => Some(match raw.trim() {
            "" => None,
            value => Some(ai::normalize_base_url(value)?),
        }),
        None => None,
    };

    update_settings(&app, |settings| {
        settings.update_prefs(id, |prefs| {
            if let Some(model) = model {
                prefs.model = model;
            }
            if let Some(base_url) = base_url {
                prefs.base_url = base_url;
            }
        });
        Ok(())
    })
}

#[tauri::command]
pub fn provider_set_key(app: AppHandle, id: ProviderId, key: String) -> AppResult<SettingsView> {
    if id.key_policy() == KeyPolicy::None {
        return Err(AppError::InvalidInput(
            "this provider does not use a key".into(),
        ));
    }
    keys::set(id, &key)?;
    Ok(broadcast_settings(
        &app,
        &app.state::<SettingsState>().get(),
    ))
}

#[tauri::command]
pub fn provider_delete_key(app: AppHandle, id: ProviderId) -> AppResult<SettingsView> {
    keys::delete(id)?;
    Ok(broadcast_settings(
        &app,
        &app.state::<SettingsState>().get(),
    ))
}

/// "Test connection": lists the provider's models with the saved URL and key.
#[tauri::command]
pub async fn provider_test(app: AppHandle, id: ProviderId) -> AppResult<Vec<String>> {
    let cfg = session::provider_config(&app, id)?;
    let http = app.state::<AiState>().http().clone();
    Ok(ai::list_models(&http, &cfg).await?)
}

#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    action: HotkeyAction,
    accelerator: String,
) -> AppResult<SettingsView> {
    hotkeys::rebind(&app, action, &accelerator)?;
    Ok(broadcast_settings(
        &app,
        &app.state::<SettingsState>().get(),
    ))
}

#[tauri::command]
pub fn hotkeys_suspend(app: AppHandle, suspended: bool) -> AppResult<()> {
    hotkeys::suspend(&app, suspended);
    Ok(())
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn history_list(
    db: State<'_, HistoryDb>,
    limit: u32,
    before: Option<i64>,
) -> AppResult<Vec<HistoryEntry>> {
    db.list(limit, before)
}

#[tauri::command]
pub async fn history_delete(db: State<'_, HistoryDb>, id: i64) -> AppResult<bool> {
    db.delete(id)
}

#[tauri::command]
pub async fn history_clear(db: State<'_, HistoryDb>) -> AppResult<usize> {
    db.clear()
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn notification_list(
    manager: State<'_, Arc<Mutex<NotificationManager>>>,
) -> AppResult<Vec<AppNotification>> {
    let mgr = manager.lock().map_err(internal)?;
    Ok(mgr.list())
}

#[tauri::command]
pub fn notification_dismiss(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<NotificationManager>>>,
    id: String,
) -> AppResult<bool> {
    let mut mgr = manager.lock().map_err(internal)?;
    let dismissed = mgr.dismiss(&id);
    if dismissed {
        let all = mgr.list();
        let _ = app.emit("notification://updated", &all);
    }
    Ok(dismissed)
}

#[tauri::command]
pub fn notification_clear_all(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<NotificationManager>>>,
) -> AppResult<()> {
    let mut mgr = manager.lock().map_err(internal)?;
    mgr.clear_all();
    let _ = app.emit("notification://updated", Vec::<AppNotification>::new());
    Ok(())
}

#[tauri::command]
pub fn notification_open_app(app_name: String, app_id: Option<String>) -> AppResult<bool> {
    Ok(notifications::listener::open_app_window(
        &app_name,
        app_id.as_deref(),
    ))
}

#[tauri::command]
pub fn notification_simulate(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<NotificationManager>>>,
    notification: AppNotification,
) -> AppResult<()> {
    let (should_popup, added) = {
        let mut mgr = manager.lock().map_err(internal)?;
        mgr.add(notification.clone())
    };
    if added {
        let all = {
            let mgr = manager.lock().map_err(internal)?;
            mgr.list()
        };
        let _ = app.emit("notification://updated", &all);
        if should_popup {
            let _ = app.emit("notification://popup", &notification);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn notification_update_settings(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<NotificationManager>>>,
    settings_state: State<'_, SettingsState>,
    settings: NotificationSettings,
) -> AppResult<NotificationSettings> {
    {
        let mut mgr = manager.lock().map_err(internal)?;
        mgr.update_settings(settings.clone());
    }
    let _ = settings_state.update(&app, |s| {
        s.notifications = settings.clone();
        Ok(())
    });
    let _ = app.emit("settings://changed", ());
    Ok(settings)
}

#[tauri::command]
pub fn media_get_state(manager: State<'_, MediaManager>) -> AppResult<MediaState> {
    Ok(manager.get())
}

#[tauri::command]
pub fn media_toggle_play_pause(manager: State<'_, MediaManager>) -> AppResult<()> {
    manager.send_action(MediaAction::TogglePlayPause)
}

#[tauri::command]
pub fn media_play(manager: State<'_, MediaManager>) -> AppResult<()> {
    manager.send_action(MediaAction::Play)
}

#[tauri::command]
pub fn media_pause(manager: State<'_, MediaManager>) -> AppResult<()> {
    manager.send_action(MediaAction::Pause)
}

#[tauri::command]
pub fn media_next(manager: State<'_, MediaManager>) -> AppResult<()> {
    manager.send_action(MediaAction::Next)
}

#[tauri::command]
pub fn media_previous(manager: State<'_, MediaManager>) -> AppResult<()> {
    manager.send_action(MediaAction::Previous)
}

#[tauri::command]
pub fn media_seek(manager: State<'_, MediaManager>, position_ms: u64) -> AppResult<()> {
    manager.send_action(MediaAction::Seek(position_ms))
}

#[tauri::command]
pub fn media_set_volume(volume: f32) -> AppResult<()> {
    media::smtc::set_master_volume(volume)
}

#[tauri::command]
pub fn media_toggle_mute() -> AppResult<bool> {
    media::smtc::toggle_master_mute()
}

#[tauri::command]
pub fn clipboard_get_history(
    manager: State<'_, std::sync::Arc<system::clipboard::ClipboardManager>>,
) -> AppResult<Vec<system::clipboard::ClipboardItem>> {
    Ok(manager.get_history())
}

#[tauri::command]
pub fn clipboard_delete_item(
    manager: State<'_, std::sync::Arc<system::clipboard::ClipboardManager>>,
    id: String,
) -> AppResult<bool> {
    Ok(manager.delete_item(&id))
}

#[tauri::command]
pub fn clipboard_clear_history(
    manager: State<'_, std::sync::Arc<system::clipboard::ClipboardManager>>,
) -> AppResult<()> {
    manager.clear();
    Ok(())
}

#[tauri::command]
pub async fn ports_get_active() -> AppResult<Vec<system::ports::PortInfo>> {
    system::ports::get_active_ports().await
}

#[tauri::command]
pub async fn ports_kill_process(pid: u32) -> AppResult<()> {
    system::ports::kill_process_by_pid(pid).await
}

#[tauri::command]
pub async fn runner_execute(
    req: system::runner::RunRequest,
) -> AppResult<system::runner::RunResponse> {
    system::runner::execute_command(req).await
}

#[tauri::command]
pub fn runner_open_directory(directory: String) -> AppResult<()> {
    system::runner::open_directory(directory)
}

#[tauri::command]
pub async fn runner_stop_process(pid: u32) -> AppResult<()> {
    system::ports::kill_process_by_pid(pid).await
}

#[tauri::command]
pub async fn runner_stop_app(
    req: system::runner::StopRequest,
) -> AppResult<system::runner::RunResponse> {
    system::runner::stop_app(req).await
}

#[tauri::command]
pub async fn runner_pick_directory() -> AppResult<Option<String>> {
    system::runner::pick_directory().await
}

#[tauri::command]
pub async fn video_pick_files() -> AppResult<Vec<String>> {
    system::runner::pick_video_files().await
}

#[tauri::command]
pub async fn capture_screen_base64<R: Runtime>(
    app: AppHandle<R>,
    target: Option<CaptureTarget>,
) -> AppResult<String> {
    use crate::capture::{self, encode};
    use base64::{Engine, engine::general_purpose::STANDARD};

    let target = target.unwrap_or(CaptureTarget::Screen);
    let exclude_self = app.state::<AppState>().visible_in_capture();
    if exclude_self {
        window::apply_all(&app, false);
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    }

    let encoded = tauri::async_runtime::spawn_blocking(move || {
        let frame = capture::grab(target)?;
        encode::to_jpeg(&frame)
    })
    .await;

    if exclude_self {
        let visible = app.state::<AppState>().visible_in_capture();
        window::apply_all(&app, visible);
    }

    let encoded = encoded
        .map_err(|err| AppError::Internal(err.to_string()))?
        .map_err(|err| AppError::CaptureFailed(err.to_string()))?;

    let b64 = STANDARD.encode(&encoded.jpeg);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

#[tauri::command]
pub fn open_url_or_search(query: String) -> AppResult<bool> {
    let raw = query.trim();
    if raw.is_empty() {
        return Ok(false);
    }

    let url_to_open = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with("www.") {
        format!("https://{raw}")
    } else {
        // Percent encode query string for Google Search
        let mut encoded = String::with_capacity(raw.len() * 3);
        for b in raw.bytes() {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
                encoded.push(b as char);
            } else if b == b' ' {
                encoded.push('+');
            } else {
                use std::fmt::Write;
                let _ = write!(encoded, "%{:02X}", b);
            }
        }
        format!("https://www.google.com/search?q={encoded}")
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url_to_open])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open browser: {e}")))?;
        Ok(true)
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("Only supported on Windows".into()))
    }
}
