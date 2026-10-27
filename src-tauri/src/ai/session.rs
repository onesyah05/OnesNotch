//! Answer sessions: capture → JSON answer → follow-ups.
//!
//! Only one session exists at a time. It keeps the screenshot in memory so
//! follow-ups can refer to it (PRD A-7); starting a new answer or panic hide
//! drops it. Each run has its own id, so a run that was cancelled
//! or replaced can never write into the session that superseded it.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel};
use tokio_util::sync::CancellationToken;

use super::prompts::{self, AnswerKind, MAX_TOKENS, UiLanguage};
use super::{AnswerRequest, ImageData, KeyPolicy, ProviderConfig, ProviderId, Role, Turn};
use crate::capture::{self, CaptureTarget, encode};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::storage::db::{HistoryDb, NewEntry};
use crate::storage::{keys, settings::SettingsState};
use crate::window;

pub const MAX_FOLLOWUP_CHARS: usize = 4000;
/// Time for DWM to recompose after the notch is excluded from capture.
const STEALTH_SETTLE: Duration = Duration::from_millis(80);

/// Streamed to the frontend over a `Channel`. Mirrored in `src/lib/ipc.ts`.
#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiEvent {
    Started {
        session_id: u64,
        provider: ProviderId,
        model: String,
    },
    Captured {
        width: u32,
        height: u32,
        capture_ms: u64,
    },
    /// The whole answer at once; replies are not streamed so they can be
    /// parsed as JSON first.
    Answer {
        kind: AnswerKind,
        text: String,
    },
    Done {
        elapsed_ms: u64,
        first_token_ms: Option<u64>,
    },
    Cancelled,
    Error {
        error: AppError,
    },
}

struct Run {
    id: u64,
    cancel: CancellationToken,
}

struct Session {
    id: u64,
    target: CaptureTarget,
    lang: UiLanguage,
    image: Option<Arc<ImageData>>,
    /// Completed user/assistant exchanges.
    turns: Vec<Turn>,
    /// User turn of the running (or last failed) run.
    pending: Option<Turn>,
    run: Option<Run>,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    session: Option<Session>,
}

impl Inner {
    fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }
}

pub struct AiState {
    http: reqwest::Client,
    inner: Mutex<Inner>,
}

enum Step {
    Capture,
    Stream,
}

enum RunEnd {
    Done { first_token_ms: Option<u64> },
    Cancelled,
}

impl Default for AiState {
    fn default() -> Self {
        Self::new()
    }
}

impl AiState {
    pub fn new() -> Self {
        Self {
            http: super::http_client(),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| AppError::Internal("AI state lock poisoned".into()))
    }

    /// Cancels the running answer, if any. Returns whether one was running.
    pub fn cancel_current(&self) -> bool {
        let Ok(inner) = self.lock() else {
            return false;
        };
        match inner.session.as_ref().and_then(|s| s.run.as_ref()) {
            Some(run) => {
                run.cancel.cancel();
                true
            }
            None => false,
        }
    }

    pub fn cancel(&self, session_id: u64) {
        if let Ok(inner) = self.lock()
            && let Some(run) = inner
                .session
                .as_ref()
                .filter(|s| s.id == session_id)
                .and_then(|s| s.run.as_ref())
        {
            run.cancel.cancel();
        }
    }

    /// Cancels everything and drops the screenshot (panic hide, rule 7).
    pub fn clear(&self) {
        if let Ok(mut inner) = self.lock()
            && let Some(session) = inner.session.take()
            && let Some(run) = session.run
        {
            run.cancel.cancel();
        }
    }

    /// Runs `f` on the session only if `run_id` is still its current run.
    fn with_run<T>(
        &self,
        session_id: u64,
        run_id: u64,
        f: impl FnOnce(&mut Session) -> T,
    ) -> AppResult<T> {
        let mut inner = self.lock()?;
        inner
            .session
            .as_mut()
            .filter(|s| s.id == session_id && s.run.as_ref().is_some_and(|r| r.id == run_id))
            .map(f)
            .ok_or(AppError::SessionExpired)
    }

    fn end_run(&self, session_id: u64, run_id: u64) {
        let _ = self.with_run(session_id, run_id, |session| session.run = None);
    }
}

fn emit(channel: &Channel<AiEvent>, event: AiEvent) {
    if let Err(err) = channel.send(event) {
        tracing::debug!("AI channel closed: {err}");
    }
}

fn ensure_active<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if app.state::<AppState>().panic_active() {
        Err(AppError::Paused)
    } else {
        Ok(())
    }
}

/// Builds a provider config from settings and the keyring.
pub(crate) fn provider_config<R: Runtime>(
    app: &AppHandle<R>,
    id: ProviderId,
) -> AppResult<ProviderConfig> {
    let settings = app.state::<SettingsState>().get();
    let base_url = settings
        .base_url(id)
        .ok_or_else(|| AppError::InvalidInput("set a base URL in Settings".into()))?;
    let api_key = match id.key_policy() {
        KeyPolicy::None => None,
        KeyPolicy::Required | KeyPolicy::Optional => keys::get(id)?,
    };
    if id.key_policy() == KeyPolicy::Required && api_key.is_none() {
        return Err(AppError::NoKey);
    }
    Ok(ProviderConfig {
        id,
        base_url,
        model: settings.model(id),
        api_key,
    })
}

fn answer_config<R: Runtime>(app: &AppHandle<R>) -> AppResult<ProviderConfig> {
    let id = app.state::<SettingsState>().get().ai.provider;
    let cfg = provider_config(app, id)?;
    if cfg.model.is_empty() {
        return Err(AppError::InvalidInput("choose a model in Settings".into()));
    }
    Ok(cfg)
}

/// Captures the screen and streams a fresh answer. Replaces any earlier session.
pub(crate) fn answer<R: Runtime>(
    app: &AppHandle<R>,
    target: CaptureTarget,
    lang: UiLanguage,
    channel: Channel<AiEvent>,
) -> AppResult<u64> {
    ensure_active(app)?;
    // Fail before capturing if the provider is not set up.
    let cfg = answer_config(app)?;
    let state = app.state::<AiState>();

    let (session_id, run_id, cancel) = {
        let mut inner = state.lock()?;
        if let Some(run) = inner.session.take().and_then(|old| old.run) {
            run.cancel.cancel();
        }
        let session_id = inner.next_id();
        let run_id = inner.next_id();
        let cancel = CancellationToken::new();
        inner.session = Some(Session {
            id: session_id,
            target,
            lang,
            image: None,
            turns: Vec::new(),
            pending: None,
            run: Some(Run {
                id: run_id,
                cancel: cancel.clone(),
            }),
        });
        (session_id, run_id, cancel)
    };

    spawn(app, session_id, run_id, cfg, cancel, channel, Step::Capture);
    Ok(session_id)
}

/// Asks a follow-up about the same screenshot.
pub(crate) fn followup<R: Runtime>(
    app: &AppHandle<R>,
    session_id: u64,
    text: &str,
    channel: Channel<AiEvent>,
) -> AppResult<u64> {
    ensure_active(app)?;
    let text = text.trim();
    if text.is_empty() || text.chars().count() > MAX_FOLLOWUP_CHARS {
        return Err(AppError::InvalidInput(
            "follow-up must be 1–4000 characters".into(),
        ));
    }
    let cfg = answer_config(app)?;
    let text = text.to_owned();
    start_run(app, session_id, cfg, channel, false, move |session| {
        if session.image.is_none() {
            return Err(AppError::SessionExpired);
        }
        session.pending = Some(Turn {
            role: Role::User,
            text,
            image: None,
        });
        Ok(Step::Stream)
    })
}

/// Re-runs the last request: the failed one if there is one, otherwise the
/// last completed exchange. Recaptures if the screenshot never arrived.
pub(crate) fn retry<R: Runtime>(
    app: &AppHandle<R>,
    session_id: u64,
    channel: Channel<AiEvent>,
) -> AppResult<u64> {
    ensure_active(app)?;
    let cfg = answer_config(app)?;
    start_run(app, session_id, cfg, channel, true, |session| {
        if session.image.is_none() {
            return Ok(Step::Capture);
        }
        if session.pending.is_none() {
            if session.turns.len() < 2 {
                return Err(AppError::SessionExpired);
            }
            session.turns.pop();
            session.pending = session.turns.pop();
        }
        Ok(Step::Stream)
    })
}

fn start_run<R: Runtime>(
    app: &AppHandle<R>,
    session_id: u64,
    cfg: ProviderConfig,
    channel: Channel<AiEvent>,
    replace_running: bool,
    prepare: impl FnOnce(&mut Session) -> AppResult<Step>,
) -> AppResult<u64> {
    let state = app.state::<AiState>();
    let (run_id, cancel, step) = {
        let mut inner = state.lock()?;
        let run_id = inner.next_id();
        let session = inner
            .session
            .as_mut()
            .filter(|s| s.id == session_id)
            .ok_or(AppError::SessionExpired)?;
        if let Some(run) = session.run.take() {
            if !replace_running {
                session.run = Some(run);
                return Err(AppError::InProgress);
            }
            run.cancel.cancel();
        }
        let step = prepare(session)?;
        let cancel = CancellationToken::new();
        session.run = Some(Run {
            id: run_id,
            cancel: cancel.clone(),
        });
        (run_id, cancel, step)
    };

    spawn(app, session_id, run_id, cfg, cancel, channel, step);
    Ok(session_id)
}

fn spawn<R: Runtime>(
    app: &AppHandle<R>,
    session_id: u64,
    run_id: u64,
    cfg: ProviderConfig,
    cancel: CancellationToken,
    channel: Channel<AiEvent>,
    step: Step,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        emit(
            &channel,
            AiEvent::Started {
                session_id,
                provider: cfg.id,
                model: cfg.model.clone(),
            },
        );

        let result = run(
            &app, session_id, run_id, &cfg, &cancel, step, started, &channel,
        )
        .await;
        let state = app.state::<AiState>();
        match result {
            Ok(RunEnd::Done { first_token_ms }) => emit(
                &channel,
                AiEvent::Done {
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    first_token_ms,
                },
            ),
            Ok(RunEnd::Cancelled) => {
                state.end_run(session_id, run_id);
                emit(&channel, AiEvent::Cancelled);
            }
            Err(error) => {
                state.end_run(session_id, run_id);
                // The code is enough to debug; messages may quote content (rule 9).
                tracing::warn!("answer failed: {}", error.code());
                emit(&channel, AiEvent::Error { error });
            }
        }
    });
}

#[allow(clippy::too_many_arguments, reason = "internal step of `spawn`")]
async fn run<R: Runtime>(
    app: &AppHandle<R>,
    session_id: u64,
    run_id: u64,
    cfg: &ProviderConfig,
    cancel: &CancellationToken,
    step: Step,
    started: Instant,
    channel: &Channel<AiEvent>,
) -> AppResult<RunEnd> {
    let state = app.state::<AiState>();
    let target = state.with_run(session_id, run_id, |s| s.target)?;

    if matches!(step, Step::Capture) {
        // Not raced against `cancel`: dropping it mid-way could skip restoring
        // the capture visibility the user chose. It takes well under a second.
        let (image, capture_ms) = capture_image(app, target).await?;
        if cancel.is_cancelled() {
            return Ok(RunEnd::Cancelled);
        }
        emit(
            channel,
            AiEvent::Captured {
                width: image.width,
                height: image.height,
                capture_ms,
            },
        );
        state.with_run(session_id, run_id, |s| {
            s.image = Some(image.clone());
            s.pending = Some(Turn {
                role: Role::User,
                text: prompts::initial_request(s.target).to_owned(),
                image: Some(image),
            });
        })?;
    }

    let (system, turns) = state.with_run(session_id, run_id, |s| {
        let mut turns = s.turns.clone();
        turns.extend(s.pending.clone());
        (prompts::system_prompt(s.target, s.lang), turns)
    })?;
    if turns.last().is_none_or(|turn| turn.role != Role::User) {
        return Err(AppError::SessionExpired);
    }

    let request = AnswerRequest {
        system: &system,
        turns: &turns,
        max_tokens: MAX_TOKENS,
        structured: true,
    };
    let Some(answer) = super::complete_answer(state.http(), cfg, &request, cancel).await? else {
        return Ok(RunEnd::Cancelled);
    };
    if answer.text.trim().is_empty() {
        return Err(AppError::Provider(
            "the model returned an empty answer".into(),
        ));
    }
    let first_token = Some(started.elapsed().as_millis() as u64);
    emit(
        channel,
        AiEvent::Answer {
            kind: answer.kind,
            text: answer.text.clone(),
        },
    );

    let prompt = state.with_run(session_id, run_id, |s| {
        s.run = None;
        let user = s.pending.take();
        let prompt = user
            .as_ref()
            .filter(|turn| turn.image.is_none())
            .map(|turn| turn.text.clone());
        s.turns.extend(user);
        s.turns.push(Turn {
            role: Role::Assistant,
            text: answer.to_turn_text(),
            image: None,
        });
        prompt
    })?;
    record_history(app, cfg, target, prompt.as_deref(), &answer.text);

    Ok(RunEnd::Done {
        first_token_ms: first_token,
    })
}

fn record_history<R: Runtime>(
    app: &AppHandle<R>,
    cfg: &ProviderConfig,
    target: CaptureTarget,
    prompt: Option<&str>,
    answer: &str,
) {
    if !app.state::<SettingsState>().get().ai.history_enabled.0 {
        return;
    }
    let entry = NewEntry {
        provider: cfg.id.as_str(),
        model: &cfg.model,
        target: target.as_str(),
        prompt,
        answer,
    };
    if let Err(err) = app.state::<HistoryDb>().insert(&entry) {
        tracing::warn!("failed to save history: {}", err.code());
    }
}

/// Applies capture affinity on the main thread (where the windows live) and
/// waits until it is done.
async fn set_capture_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    let (done, wait) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        window::apply_all(&handle, visible);
        let _ = done.send(());
    });
    if queued.is_ok() {
        let _ = wait.await;
    }
}

/// Captures and encodes off the async runtime. When the user has made the
/// notch visible in captures, it is excluded just for this shot so it never
/// covers the question (PRD A-2).
async fn capture_image<R: Runtime>(
    app: &AppHandle<R>,
    target: CaptureTarget,
) -> AppResult<(Arc<ImageData>, u64)> {
    let exclude_self = app.state::<AppState>().visible_in_capture();
    if exclude_self {
        set_capture_visibility(app, false).await;
        tokio::time::sleep(STEALTH_SETTLE).await;
    }

    let started = Instant::now();
    let encoded = tauri::async_runtime::spawn_blocking(move || {
        let frame = capture::grab(target)?;
        encode::to_jpeg(&frame)
    })
    .await;
    let capture_ms = started.elapsed().as_millis() as u64;

    if exclude_self {
        // Restore whatever the user wants now; they may have toggled meanwhile.
        let visible = app.state::<AppState>().visible_in_capture();
        set_capture_visibility(app, visible).await;
    }

    let encoded = encoded
        .map_err(|err| AppError::Internal(err.to_string()))?
        .map_err(|err| AppError::CaptureFailed(err.to_string()))?;
    let image = ImageData {
        base64: STANDARD.encode(&encoded.jpeg),
        media_type: "image/jpeg",
        width: encoded.width,
        height: encoded.height,
    };
    Ok((Arc::new(image), capture_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialize_with_camel_case_tags_and_fields() {
        let started = serde_json::to_value(AiEvent::Started {
            session_id: 3,
            provider: ProviderId::OpenaiCompatible,
            model: "m".into(),
        })
        .unwrap();
        assert_eq!(started["type"], "started");
        assert_eq!(started["sessionId"], 3);
        assert_eq!(started["provider"], "openai_compatible");

        let done = serde_json::to_value(AiEvent::Done {
            elapsed_ms: 10,
            first_token_ms: Some(4),
        })
        .unwrap();
        assert_eq!(done["firstTokenMs"], 4);

        let error = serde_json::to_value(AiEvent::Error {
            error: AppError::NoKey,
        })
        .unwrap();
        assert_eq!(error["type"], "error");
        assert_eq!(error["error"]["code"], "no_key");

        assert_eq!(
            serde_json::to_value(AiEvent::Cancelled).unwrap()["type"],
            "cancelled"
        );

        let answer = serde_json::to_value(AiEvent::Answer {
            kind: AnswerKind::Pg,
            text: "3. C".into(),
        })
        .unwrap();
        assert_eq!(answer["type"], "answer");
        assert_eq!(answer["kind"], "pg");
        assert_eq!(answer["text"], "3. C");
    }

    fn state_with_session() -> (AiState, u64, u64, CancellationToken) {
        let state = AiState::new();
        let cancel = CancellationToken::new();
        {
            let mut inner = state.lock().unwrap();
            let session_id = inner.next_id();
            let run_id = inner.next_id();
            inner.session = Some(Session {
                id: session_id,
                target: CaptureTarget::Screen,
                lang: UiLanguage::En,
                image: None,
                turns: Vec::new(),
                pending: None,
                run: Some(Run {
                    id: run_id,
                    cancel: cancel.clone(),
                }),
            });
        }
        (state, 1, 2, cancel)
    }

    #[test]
    fn stale_runs_cannot_touch_the_session() {
        let (state, session_id, run_id, _) = state_with_session();
        assert!(state.with_run(session_id, run_id, |_| ()).is_ok());
        assert!(matches!(
            state.with_run(session_id, run_id + 1, |_| ()),
            Err(AppError::SessionExpired)
        ));
        state.end_run(session_id, run_id);
        assert!(state.with_run(session_id, run_id, |_| ()).is_err());
    }

    #[test]
    fn cancel_current_and_clear_cancel_the_token() {
        let (state, _, _, cancel) = state_with_session();
        assert!(state.cancel_current());
        assert!(cancel.is_cancelled());

        let (state, _, _, cancel) = state_with_session();
        state.clear();
        assert!(cancel.is_cancelled());
        assert!(!state.cancel_current(), "session is gone");
    }

    #[test]
    fn cancel_ignores_other_sessions() {
        let (state, session_id, _, cancel) = state_with_session();
        state.cancel(session_id + 10);
        assert!(!cancel.is_cancelled());
        state.cancel(session_id);
        assert!(cancel.is_cancelled());
    }
}
