mod ai;
mod capture;
mod commands;
mod error;
mod hotkeys;
mod media;
mod notifications;
mod state;
mod storage;
mod system;
mod window;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::storage::{db::HistoryDb, settings::SettingsState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logs must never contain screen content, prompts, answers or secrets (AGENTS.md rule 9).
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("notch_lib=info")),
        )
        .init();

    storage::keys::init();

    let result = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "settings"
            {
                api.prevent_close();
                if let Some(webview) = window.app_handle().get_webview_window(window.label())
                    && let Err(err) = crate::window::stealth::hide(&webview)
                {
                    tracing::warn!("failed to hide settings window: {err}");
                }
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("notch")
                && let Err(err) = window.show()
            {
                tracing::warn!("failed to show notch after second launch: {err}");
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Used from Rust only (`system::autostart`); the webview has no permission.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        // Used from Rust only (`system::updater`); the webview has no permission.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Used from Rust only; the webview has no store permissions.
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .manage(ai::session::AiState::new())
        .manage(hotkeys::HotkeyState::default())
        .manage(system::stats::SystemStatsMonitor::new())
        .manage(system::updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_status,
            commands::set_notch_state,
            commands::set_answer_size,
            commands::set_concealed,
            commands::set_visible_in_capture,
            commands::set_opacity,
            commands::theme_set,
            commands::show_settings,
            commands::hide_settings,
            commands::toggle_panic,
            commands::clipboard_write,
            commands::get_system_stats,
            commands::ai_answer,
            commands::ai_followup,
            commands::ai_retry,
            commands::ai_cancel,
            commands::settings_get,
            commands::settings_update,
            commands::provider_update,
            commands::provider_set_key,
            commands::provider_delete_key,
            commands::provider_test,
            commands::autostart_set,
            commands::auto_hide_update,
            commands::water_update,
            commands::update_status,
            commands::update_check,
            commands::update_install,
            commands::update_set_auto_check,
            commands::hotkey_set,
            commands::hotkeys_suspend,
            commands::history_list,
            commands::history_delete,
            commands::history_clear,
            commands::notification_list,
            commands::notification_dismiss,
            commands::notification_clear_all,
            commands::notification_open_app,
            commands::notification_simulate,
            commands::notification_update_settings,
            commands::media_get_state,
            commands::media_toggle_play_pause,
            commands::media_play,
            commands::media_pause,
            commands::media_next,
            commands::media_previous,
            commands::media_seek,
            commands::media_set_volume,
            commands::media_toggle_mute,
            commands::clipboard_get_history,
            commands::clipboard_delete_item,
            commands::clipboard_clear_history,
            commands::ports_get_active,
            commands::ports_kill_process,
            commands::runner_execute,
            commands::runner_open_directory,
            commands::runner_stop_process,
            commands::runner_stop_app,
            commands::runner_pick_directory,
            commands::video_pick_files,
            commands::capture_screen_base64,
            commands::open_url_or_search,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Hard rule 1: every window is stealth-applied right after creation.
            window::apply_all(&handle, false);

            let settings = SettingsState::load(&handle);
            system::autostart::sync_on_startup(&handle, settings.get().autostart.0);
            handle
                .state::<state::AppState>()
                .set_opacity(settings.get().opacity.0);
            let notif_manager = std::sync::Arc::new(std::sync::Mutex::new(
                notifications::listener::NotificationManager::new(
                    settings.get().notifications.clone(),
                ),
            ));
            app.manage(notif_manager.clone());
            let clipboard_manager = std::sync::Arc::new(system::clipboard::ClipboardManager::new());
            app.manage(clipboard_manager.clone());
            app.manage(settings);

            let history_path = handle
                .path()
                .app_data_dir()
                .map(|dir| dir.join("history.sqlite3"));
            match history_path {
                Ok(path) => {
                    app.manage(HistoryDb::open(&path));
                }
                Err(err) => {
                    tracing::error!("no app data dir, history disabled: {err}");
                    app.manage(HistoryDb::open(std::path::Path::new(":memory:")));
                }
            }

            if let Err(err) = window::position::place(&handle) {
                tracing::warn!("failed to place notch: {err}");
            }
            hotkeys::register_all(&handle);
            window::spawn_background_workers(handle.clone());
            system::stats::spawn_stats_emitter(handle.clone());
            system::updater::spawn_checker(handle.clone());
            notifications::listener::spawn_notification_listener(handle.clone(), notif_manager);
            system::clipboard::spawn_clipboard_listener(handle.clone(), clipboard_manager);
            let media_manager = media::spawn_media_listener(handle);
            app.manage(media_manager);

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(err) = result {
        tracing::error!("failed to run Notch: {err}");
        std::process::exit(1);
    }
}
