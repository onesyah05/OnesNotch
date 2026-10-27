//! Windows System Media Transport Controls (SMTC) and Core Audio integration.
//! Allows controlling media playback (Spotify, Chrome, Edge, YouTube Music, etc.)
//! and system volume without opening the applications.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    },
    Storage::Streams::DataReader,
    Win32::{
        Media::Audio::{
            Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia,
            eRender,
        },
        System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx},
    },
};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub is_playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app_name: String,
    pub cover_url: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32, // 0.0 to 1.0
    pub is_muted: bool,
    pub can_play_pause: bool,
    pub can_skip_next: bool,
    pub can_skip_previous: bool,
    pub can_seek: bool,
}

#[derive(Debug, Clone)]
pub enum MediaAction {
    TogglePlayPause,
    Play,
    Pause,
    Next,
    Previous,
    Seek(u64),
}

/// Global shared state of current media info to avoid redundant polling and allocations.
#[derive(Clone)]
pub struct MediaManager {
    current: Arc<Mutex<MediaState>>,
    action_tx: UnboundedSender<MediaAction>,
}

impl MediaManager {
    pub fn new(action_tx: UnboundedSender<MediaAction>) -> Self {
        Self {
            current: Arc::new(Mutex::new(MediaState::default())),
            action_tx,
        }
    }

    pub fn get(&self) -> MediaState {
        self.current.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set(&self, state: MediaState) {
        if let Ok(mut lock) = self.current.lock() {
            *lock = state;
        }
    }

    pub fn send_action(&self, action: MediaAction) -> AppResult<()> {
        self.action_tx
            .send(action)
            .map_err(|e| AppError::Internal(format!("Failed to send media action: {e}")))
    }
}

/// Query current media state from Windows SMTC session and Core Audio.
pub async fn query_media_state() -> MediaState {
    let mut state = MediaState::default();

    // Query volume & mute from Windows Core Audio
    let (vol, muted) = get_master_volume();
    state.volume = vol;
    state.is_muted = muted;

    // Query SMTC session
    let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
        Ok(op) => match op.await {
            Ok(m) => m,
            Err(_) => return state,
        },
        Err(_) => return state,
    };

    let session = match manager.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => return state,
    };

    // Extract App Name (SourceAppUserModelId, e.g. "Spotify.exe", "msedge.exe")
    if let Ok(app_id) = session.SourceAppUserModelId() {
        let raw = app_id.to_string();
        state.app_name = clean_app_name(&raw);
    }

    // Extract playback info
    if let Ok(info) = session.GetPlaybackInfo() {
        if let Ok(status) = info.PlaybackStatus() {
            state.is_playing =
                status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
        }
        if let Ok(controls) = info.Controls() {
            state.can_play_pause = controls.IsPlayEnabled().unwrap_or(true)
                || controls.IsPauseEnabled().unwrap_or(true);
            state.can_skip_next = controls.IsNextEnabled().unwrap_or(true);
            state.can_skip_previous = controls.IsPreviousEnabled().unwrap_or(true);
        } else {
            state.can_play_pause = true;
            state.can_skip_next = true;
            state.can_skip_previous = true;
        }
    }

    // Extract timeline
    if let Ok(timeline) = session.GetTimelineProperties() {
        if let Ok(pos) = timeline.Position() {
            state.position_ms = (pos.Duration / 10_000).max(0) as u64;
        }
        if let Ok(end) = timeline.EndTime() {
            state.duration_ms = (end.Duration / 10_000).max(0) as u64;
            state.can_seek = state.duration_ms > 0;
        }
    }

    // Extract media properties (Title, Artist, Album, Thumbnail)
    if let Ok(props_op) = session.TryGetMediaPropertiesAsync()
        && let Ok(props) = props_op.await
    {
        if let Ok(t) = props.Title() {
            state.title = t.to_string();
        }
        if let Ok(a) = props.Artist() {
            state.artist = a.to_string();
        }
        if let Ok(alb) = props.AlbumTitle() {
            state.album = alb.to_string();
        }
        state.cover_url = extract_thumbnail(&props).await;
    }

    state
}

async fn extract_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let thumb_ref = props.Thumbnail().ok()?;
    let stream_op = thumb_ref.OpenReadAsync().ok()?;
    drop(thumb_ref);
    let stream = stream_op.await.ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size >= 5 * 1024 * 1024 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let load_op = reader.LoadAsync(size as u32).ok()?;
    load_op.await.ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/jpeg;base64,{b64}"))
}

fn clean_app_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("spotify") {
        "Spotify".to_string()
    } else if lower.contains("chrome") {
        "Google Chrome".to_string()
    } else if lower.contains("edge") {
        "Microsoft Edge".to_string()
    } else if lower.contains("firefox") {
        "Firefox".to_string()
    } else if lower.contains("music") {
        "Music".to_string()
    } else {
        raw.split('\\')
            .next_back()
            .unwrap_or(raw)
            .trim_end_matches(".exe")
            .to_string()
    }
}

/// Helper to get current active SMTC session
async fn get_current_session() -> Result<GlobalSystemMediaTransportControlsSession, AppError> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| AppError::Internal(format!("SMTC Manager request error: {e}")))?
        .await
        .map_err(|e| AppError::Internal(format!("SMTC Manager await error: {e}")))?;

    manager
        .GetCurrentSession()
        .map_err(|_| AppError::InvalidInput("No active media session".to_string()))
}

async fn handle_media_action(action: MediaAction) {
    let Ok(session) = get_current_session().await else {
        return;
    };
    match action {
        MediaAction::TogglePlayPause => {
            if let Ok(op) = session.TryTogglePlayPauseAsync() {
                let _ = op.await;
            }
        }
        MediaAction::Play => {
            if let Ok(op) = session.TryPlayAsync() {
                let _ = op.await;
            }
        }
        MediaAction::Pause => {
            if let Ok(op) = session.TryPauseAsync() {
                let _ = op.await;
            }
        }
        MediaAction::Next => {
            if let Ok(op) = session.TrySkipNextAsync() {
                let _ = op.await;
            }
        }
        MediaAction::Previous => {
            if let Ok(op) = session.TrySkipPreviousAsync() {
                let _ = op.await;
            }
        }
        MediaAction::Seek(pos_ms) => {
            let ticks = (pos_ms as i64) * 10_000;
            if let Ok(op) = session.TryChangePlaybackPositionAsync(ticks) {
                let _ = op.await;
            }
        }
    }
}

/// Master volume getter (returns 0.0 .. 1.0, is_muted)
pub fn get_master_volume() -> (f32, bool) {
    unsafe {
        let enumerator: Result<IMMDeviceEnumerator, _> =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
        let Ok(enumerator) = enumerator else {
            return (1.0, false);
        };
        let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
            return (1.0, false);
        };
        let Ok(endpoint_volume) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) else {
            return (1.0, false);
        };
        let level = endpoint_volume.GetMasterVolumeLevelScalar().unwrap_or(1.0);
        let muted = endpoint_volume
            .GetMute()
            .map(|b| b.as_bool())
            .unwrap_or(false);
        (level, muted)
    }
}

/// Set master system volume (level between 0.0 and 1.0)
pub fn set_master_volume(level: f32) -> AppResult<()> {
    let clamped = level.clamp(0.0, 1.0);
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| AppError::Internal(format!("CoCreateInstance error: {e}")))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| AppError::Internal(format!("GetDefaultAudioEndpoint error: {e}")))?;
        let endpoint_volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| AppError::Internal(format!("Activate volume endpoint error: {e}")))?;
        endpoint_volume
            .SetMasterVolumeLevelScalar(clamped, std::ptr::null())
            .map_err(|e| AppError::Internal(format!("SetMasterVolumeLevelScalar error: {e}")))?;
    }
    Ok(())
}

/// Toggle master system mute
pub fn toggle_master_mute() -> AppResult<bool> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| AppError::Internal(format!("CoCreateInstance error: {e}")))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| AppError::Internal(format!("GetDefaultAudioEndpoint error: {e}")))?;
        let endpoint_volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| AppError::Internal(format!("Activate volume endpoint error: {e}")))?;
        let muted = endpoint_volume
            .GetMute()
            .map_err(|e| AppError::Internal(format!("GetMute error: {e}")))?
            .as_bool();
        let next_mute = !muted;
        endpoint_volume
            .SetMute(next_mute, std::ptr::null())
            .map_err(|e| AppError::Internal(format!("SetMute error: {e}")))?;
        Ok(next_mute)
    }
}

static LISTENER_SPAWNED: AtomicBool = AtomicBool::new(false);

/// Spawns the media background worker on a dedicated thread with COM MTA and tokio runtime.
pub fn spawn_media_listener(app: AppHandle) -> MediaManager {
    let (tx, mut rx) = unbounded_channel::<MediaAction>();
    let manager = MediaManager::new(tx);
    let manager_clone = manager.clone();

    if !LISTENER_SPAWNED.swap(true, Ordering::SeqCst) {
        let builder = std::thread::Builder::new().name("media-listener".into());
        if let Err(err) = builder.spawn(move || {
            // SAFETY: Background worker thread, initialized with MTA.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }

            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(err) => {
                    tracing::warn!("failed to create media tokio runtime: {err}");
                    return;
                }
            };

            rt.block_on(async move {
                tracing::info!("Media listener thread started (COM MTA)");

                let mut prev_state = MediaState::default();

                loop {
                    let sleep_ms = if prev_state.is_playing { 500 } else { 1500 };

                    tokio::select! {
                        Some(action) = rx.recv() => {
                            handle_media_action(action).await;
                            let state = query_media_state().await;
                            manager_clone.set(state.clone());
                            let _ = app.emit("media://changed", &state);
                            prev_state = state;
                        }
                        _ = tokio::time::sleep(Duration::from_millis(sleep_ms)) => {
                            let state = query_media_state().await;
                            manager_clone.set(state.clone());

                            let track_changed =
                                state.title != prev_state.title || state.artist != prev_state.artist;
                            let status_changed = state.is_playing != prev_state.is_playing
                                || state.is_muted != prev_state.is_muted;
                            let significant_time_change =
                                (state.position_ms as i64 - prev_state.position_ms as i64).abs() >= 1000;
                            let vol_changed = (state.volume - prev_state.volume).abs() > 0.02;

                            if track_changed || status_changed || significant_time_change || vol_changed {
                                let _ = app.emit("media://changed", &state);
                                prev_state = state;
                            }
                        }
                    }
                }
            });
        }) {
            tracing::warn!("failed to spawn media-listener thread: {err}");
        }
    }

    manager
}
