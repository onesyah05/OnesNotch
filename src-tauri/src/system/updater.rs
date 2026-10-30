//! In-app updates via `tauri-plugin-updater`.
//!
//! Each GitHub release carries a signed NSIS installer plus `latest.json`
//! (see `.github/workflows/release.yml`). The app checks shortly after start
//! and then every few hours; when a newer version exists it tells every
//! window through `update://available`. Installing downloads the installer,
//! verifies its signature against the public key in `tauri.conf.json`, and
//! runs it, which closes the app and restarts it on the new version.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, ipc::Channel};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::storage::settings::SettingsState;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Progress events are throttled to roughly one per this many bytes.
const PROGRESS_STEP: u64 = 256 * 1024;

/// A newer release. Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// Release notes from `latest.json`, usually the changelog section.
    pub notes: Option<String>,
    /// Publish date, Unix milliseconds.
    pub date_ms: Option<i64>,
}

/// Install progress, streamed over a channel. Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateEvent {
    Progress {
        downloaded: u64,
        total: Option<u64>,
    },
    /// Download verified; the installer is starting and the app will close.
    Installing,
}

/// Last check result, so a window opened later can ask for it.
#[derive(Default)]
pub struct UpdateState {
    available: Mutex<Option<UpdateInfo>>,
    installing: AtomicBool,
}

impl UpdateState {
    pub fn available(&self) -> Option<UpdateInfo> {
        self.available
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    fn set_available(&self, info: Option<UpdateInfo>) {
        if let Ok(mut guard) = self.available.lock() {
            *guard = info;
        }
    }
}

fn update_error(err: impl std::fmt::Display) -> AppError {
    AppError::Update(err.to_string())
}

/// Asks the release endpoint for a newer version and broadcasts the result.
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> AppResult<Option<UpdateInfo>> {
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?;
    let info = update.map(|update| UpdateInfo {
        version: update.version,
        current_version: update.current_version,
        notes: update.body.filter(|notes| !notes.trim().is_empty()),
        date_ms: update.date.map(|date| date.unix_timestamp() * 1000),
    });

    app.state::<UpdateState>().set_available(info.clone());
    if let Some(info) = &info {
        tracing::info!("update available: {}", info.version);
        if let Err(err) = app.emit("update://available", info) {
            tracing::debug!("failed to broadcast update: {err}");
        }
    }
    Ok(info)
}

/// Downloads, verifies and runs the installer. On Windows the installer
/// closes the app, so a successful call does not return to the UI.
pub async fn install<R: Runtime>(
    app: &AppHandle<R>,
    on_event: Channel<UpdateEvent>,
) -> AppResult<()> {
    let state = app.state::<UpdateState>();
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err(AppError::InProgress);
    }
    let result = download_and_install(app, on_event).await;
    state.installing.store(false, Ordering::SeqCst);
    result
}

async fn download_and_install<R: Runtime>(
    app: &AppHandle<R>,
    on_event: Channel<UpdateEvent>,
) -> AppResult<()> {
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?
        .ok_or_else(|| AppError::InvalidInput("no update available".into()))?;

    let progress = on_event.clone();
    let mut downloaded = 0u64;
    let mut last_sent: Option<u64> = None;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let done = total.is_some_and(|total| downloaded >= total);
                let due = last_sent.is_none_or(|sent| downloaded - sent >= PROGRESS_STEP);
                if due || done {
                    last_sent = Some(downloaded);
                    let _ = progress.send(UpdateEvent::Progress { downloaded, total });
                }
            },
            move || {
                let _ = on_event.send(UpdateEvent::Installing);
            },
        )
        .await
        .map_err(update_error)
}

/// Checks shortly after start, then every [`CHECK_INTERVAL`], unless the user
/// turned automatic checks off or panic hide is active (rule 7).
pub fn spawn_checker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let enabled = app.state::<SettingsState>().get().updates.auto_check;
            let paused = app.state::<AppState>().panic_active();
            if enabled
                && !paused
                && let Err(err) = check(&app).await
            {
                // Expected while offline or before the first signed release.
                tracing::debug!("update check failed: {err}");
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}
