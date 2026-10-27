//! AI providers (BYOK). All HTTP happens here; keys never reach the webview.
//!
//! Each provider implements [`Provider`]: it builds requests and parses one
//! stream record at a time. The shared [`complete_answer`] loop owns HTTP
//! status handling and cancellation, so adding a provider is one file plus
//! a line in [`ProviderId::provider`].

mod anthropic;
mod gemini;
mod ollama;
mod openai;
pub(crate) mod prompts;
pub(crate) mod session;
pub(crate) mod sse;

use std::sync::Arc;
use std::time::Duration;

use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use sse::{Framing, Record};

const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
/// Error bodies are only read this far; they are short JSON in practice.
const MAX_ERROR_BODY: usize = 16 * 1024;
const MAX_ERROR_MESSAGE: usize = 300;

/// Mirrored in `src/lib/ipc.ts`.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    #[default]
    Anthropic,
    Openai,
    Gemini,
    Ollama,
    OpenaiCompatible,
}

/// Whether a provider needs an API key. Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyPolicy {
    Required,
    Optional,
    None,
}

impl ProviderId {
    pub const ALL: [Self; 5] = [
        Self::Anthropic,
        Self::Openai,
        Self::Gemini,
        Self::Ollama,
        Self::OpenaiCompatible,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
            Self::OpenaiCompatible => "openai_compatible",
        }
    }

    pub const fn key_policy(self) -> KeyPolicy {
        match self {
            Self::Anthropic | Self::Openai | Self::Gemini => KeyPolicy::Required,
            Self::OpenaiCompatible => KeyPolicy::Optional,
            Self::Ollama => KeyPolicy::None,
        }
    }

    /// Defaults are only fallbacks; users pick models in Settings.
    /// Anthropic IDs follow AGENTS.md (check the docs before changing them).
    pub const fn default_model(self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-5-5",
            // Reasoning effort defaults to `none` here, which keeps the first token fast.
            Self::Openai => "gpt-5.2",
            // Official alias that tracks Google's current Flash model.
            Self::Gemini => "gemini-flash-latest",
            Self::Ollama => "gemma3",
            Self::OpenaiCompatible => "",
        }
    }

    pub const fn default_base_url(self) -> Option<&'static str> {
        match self {
            Self::Anthropic => Some("https://api.anthropic.com"),
            Self::Openai => Some("https://api.openai.com/v1"),
            Self::Gemini => Some("https://generativelanguage.googleapis.com/v1beta"),
            Self::Ollama => Some("http://localhost:11434"),
            Self::OpenaiCompatible => None,
        }
    }

    /// Hosted providers keep a fixed URL so a key can never be redirected
    /// to another host (AGENTS.md, OpenAI-compatible provider).
    pub const fn base_url_editable(self) -> bool {
        matches!(self, Self::Ollama | Self::OpenaiCompatible)
    }

    fn provider(self) -> &'static dyn Provider {
        match self {
            Self::Anthropic => &anthropic::Anthropic,
            Self::Openai => &openai::OpenAi { official: true },
            Self::OpenaiCompatible => &openai::OpenAi { official: false },
            Self::Gemini => &gemini::Gemini,
            Self::Ollama => &ollama::Ollama,
        }
    }
}

/// Everything needed to talk to one provider.
#[derive(Clone)]
pub struct ProviderConfig {
    pub id: ProviderId,
    /// Normalized, without a trailing slash.
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

// Hand-written so the key can never end up in a log line (rule 5).
impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderConfig")
            .field("id", &self.id)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("has_key", &self.api_key.is_some())
            .finish()
    }
}

impl ProviderConfig {
    fn key(&self) -> Option<&str> {
        self.api_key.as_deref().filter(|key| !key.is_empty())
    }
}

/// A screenshot ready to embed in a request. Lives only in memory (rule 4).
pub struct ImageData {
    pub base64: String,
    pub media_type: &'static str,
    pub width: u32,
    pub height: u32,
}

impl std::fmt::Debug for ImageData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ImageData")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

/// One conversation message. Not `Debug`: it holds prompt and answer text (rule 9).
#[derive(Clone)]
pub struct Turn {
    pub role: Role,
    pub text: String,
    pub image: Option<Arc<ImageData>>,
}

pub struct AnswerRequest<'a> {
    pub system: &'a str,
    pub turns: &'a [Turn],
    pub max_tokens: u32,
    /// Ask the provider to enforce [`prompts::answer_schema`]. Turned off only
    /// for the retry against servers that reject structured output.
    pub structured: bool,
}

/// What one stream record contributed.
#[allow(dead_code)]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Chunk {
    pub text: String,
    pub done: bool,
}

#[allow(dead_code)]
impl Chunk {
    fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            done: false,
        }
    }

    fn done() -> Self {
        Self {
            text: String::new(),
            done: true,
        }
    }

    fn skip() -> Self {
        Self::default()
    }
}

pub(crate) trait Provider: Send + Sync {
    #[allow(dead_code)]
    fn framing(&self) -> Framing {
        Framing::Sse
    }
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder;
    /// Parses one record. Unknown shapes are skipped, not treated as errors,
    /// so OpenAI-compatible servers with extra fields keep working.
    #[allow(dead_code)]
    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError>;
    /// Pulls the assistant text out of a non-streaming JSON body.
    fn parse_complete(&self, body: &Value) -> Result<String, AiError>;
    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder;
    fn parse_models(&self, body: &Value) -> Vec<String>;
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AiError {
    #[error("invalid API key")]
    InvalidKey,
    #[error("quota or rate limit exceeded")]
    Quota,
    #[error("provider is overloaded")]
    Busy,
    #[error("model not found")]
    ModelNotFound,
    #[error("model does not accept images")]
    NoVision,
    #[error("network unavailable")]
    Offline,
    #[error("request timed out")]
    Timeout,
    #[error("{0}")]
    Provider(String),
}

impl From<AiError> for AppError {
    fn from(err: AiError) -> Self {
        match err {
            AiError::InvalidKey => Self::InvalidKey,
            AiError::Quota => Self::Quota,
            AiError::Busy => Self::Busy,
            AiError::ModelNotFound => Self::ModelNotFound,
            AiError::NoVision => Self::NoVision,
            AiError::Offline => Self::Offline,
            AiError::Timeout => Self::Timeout,
            AiError::Provider(message) => Self::Provider(message),
        }
    }
}

impl From<reqwest::Error> for AiError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::Timeout
        } else if err.is_connect() {
            Self::Offline
        } else {
            Self::Provider(err.without_url().to_string())
        }
    }
}

fn truncate(text: &str, max: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(max) {
        Some((index, _)) => format!("{}…", &text[..index]),
        None => text.to_owned(),
    }
}

/// Pulls a human-readable message out of the usual error body shapes.
fn error_message(body: &str) -> String {
    let message = serde_json::from_str::<Value>(body).ok().and_then(|json| {
        let candidates = [
            json.pointer("/error/message"),
            json.get("error"),
            json.get("message"),
            json.get("detail"),
        ];
        candidates
            .into_iter()
            .flatten()
            .find_map(|value| value.as_str().map(str::to_owned))
    });
    truncate(message.as_deref().unwrap_or(body), MAX_ERROR_MESSAGE)
}

/// Maps a provider error message to a friendly category.
fn classify_message(message: &str) -> AiError {
    let lower = message.to_lowercase();
    let has = |needle: &str| lower.contains(needle);

    if has("api_key_invalid")
        || (has("api key") && (has("invalid") || has("not valid") || has("incorrect")))
        || has("unauthorized")
        || has("authentication")
    {
        AiError::InvalidKey
    } else if has("quota")
        || has("rate limit")
        || has("rate_limit")
        || has("too many requests")
        || has("resource_exhausted")
    {
        AiError::Quota
    } else if has("overloaded") {
        AiError::Busy
    } else if (has("image") || has("vision") || has("multimodal"))
        && (has("support") || has("not ") || has("invalid") || has("cannot"))
    {
        AiError::NoVision
    } else if has("model")
        && (has("not found") || has("not_found") || has("does not exist") || has("unknown"))
    {
        AiError::ModelNotFound
    } else {
        AiError::Provider(truncate(message, MAX_ERROR_MESSAGE))
    }
}

fn classify_http(status: u16, body: &str) -> AiError {
    let message = error_message(body);
    match status {
        401 | 403 => AiError::InvalidKey,
        429 => AiError::Quota,
        503 | 529 => AiError::Busy,
        404 if message.to_lowercase().contains("model") => AiError::ModelNotFound,
        _ => match classify_message(&message) {
            AiError::Provider(message) if message.is_empty() => {
                AiError::Provider(format!("HTTP {status}"))
            }
            AiError::Provider(message) => AiError::Provider(format!("HTTP {status}: {message}")),
            other => other,
        },
    }
}

async fn read_error(mut response: reqwest::Response) -> AiError {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while body.len() < MAX_ERROR_BODY {
        match response.chunk().await {
            Ok(Some(chunk)) => body.extend_from_slice(&chunk),
            _ => break,
        }
    }
    // Only the status is logged; bodies can echo request content (rule 9).
    tracing::warn!("provider returned HTTP {status}");
    classify_http(status, &String::from_utf8_lossy(&body))
}

/// Validates a user-supplied base URL and strips the trailing slash.
pub fn normalize_base_url(raw: &str) -> Result<String, AppError> {
    let invalid = |why: &str| AppError::InvalidInput(format!("invalid base URL: {why}"));
    let url = Url::parse(raw.trim()).map_err(|_| invalid("not a URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid("must start with http:// or https://"));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(invalid("missing host"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("credentials belong in the API key field"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("query strings are not supported"));
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

/// Validates a free-text model name.
pub fn normalize_model(raw: &str) -> Result<String, AppError> {
    let model = raw.trim();
    let valid = !model.is_empty()
        && model.chars().count() <= 200
        && !model
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '?' || c == '#');
    if valid {
        Ok(model.to_owned())
    } else {
        Err(AppError::InvalidInput("invalid model name".into()))
    }
}

pub(crate) fn http_client() -> Client {
    let builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // Local models can take a while to load before the first byte.
        .read_timeout(Duration::from_secs(120))
        .user_agent(concat!("Notch/", env!("CARGO_PKG_VERSION")));
    match builder.build() {
        Ok(client) => client,
        Err(err) => {
            tracing::error!("failed to build HTTP client, using defaults: {err}");
            Client::new()
        }
    }
}

/// Completes one answer as a single JSON body and parses it. Returns `None`
/// when cancelled.
pub(crate) async fn complete_answer(
    http: &Client,
    cfg: &ProviderConfig,
    req: &AnswerRequest<'_>,
    cancel: &CancellationToken,
) -> Result<Option<prompts::ParsedAnswer>, AiError> {
    let raw = match request_answer(http, cfg, req, cancel).await {
        // Some OpenAI-compatible servers reject `response_format`; the prompt
        // alone still asks for JSON, and the parser tolerates stray prose.
        Err(AiError::Provider(message))
            if req.structured
                && cfg.id == ProviderId::OpenaiCompatible
                && message.starts_with("HTTP 400") =>
        {
            tracing::info!("structured output rejected; retrying without a schema");
            let plain = AnswerRequest {
                structured: false,
                ..*req
            };
            request_answer(http, cfg, &plain, cancel).await?
        }
        other => other?,
    };
    Ok(raw.map(|raw| prompts::parse_answer(&raw)))
}

async fn request_answer(
    http: &Client,
    cfg: &ProviderConfig,
    req: &AnswerRequest<'_>,
    cancel: &CancellationToken,
) -> Result<Option<String>, AiError> {
    let provider = cfg.id.provider();
    let send = provider.answer_request(http, cfg, req).send();
    let response = tokio::select! {
        biased;
        () = cancel.cancelled() => return Ok(None),
        response = send => response?,
    };
    if !response.status().is_success() {
        return Err(read_error(response).await);
    }

    let body: Value = tokio::select! {
        biased;
        () = cancel.cancelled() => return Ok(None),
        json = response.json() => json?,
    };
    provider.parse_complete(&body).map(Some)
}

/// Lists models; doubles as "test connection" for the URL and key.
pub(crate) async fn list_models(
    http: &Client,
    cfg: &ProviderConfig,
) -> Result<Vec<String>, AiError> {
    let provider = cfg.id.provider();
    let response = provider
        .models_request(http, cfg)
        .timeout(MODELS_TIMEOUT)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(read_error(response).await);
    }
    let body: Value = response.json().await?;
    let mut models = provider.parse_models(&body);
    models.sort();
    models.dedup();
    Ok(models)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::sse::Decoder;
    use super::*;

    pub fn config(id: ProviderId) -> ProviderConfig {
        ProviderConfig {
            id,
            base_url: id
                .default_base_url()
                .unwrap_or("https://llm.example.com/v1")
                .to_owned(),
            model: "test-model".into(),
            api_key: Some("sk-test-123".into()),
        }
    }

    pub fn conversation() -> Vec<Turn> {
        vec![
            Turn {
                role: Role::User,
                text: "Answer the question on my screen.".into(),
                image: Some(Arc::new(ImageData {
                    base64: "QUJD".into(),
                    media_type: "image/jpeg",
                    width: 2,
                    height: 1,
                })),
            },
            Turn {
                role: Role::Assistant,
                text: "Jawaban: B".into(),
                image: None,
            },
            Turn {
                role: Role::User,
                text: "Why not C?".into(),
                image: None,
            },
        ]
    }

    /// Builds the request without sending it and returns (url, headers, json body).
    pub fn inspect(builder: RequestBuilder) -> (String, reqwest::header::HeaderMap, Value) {
        let request = builder.build().unwrap();
        let body = request
            .body()
            .and_then(|body| body.as_bytes())
            .map(|bytes| serde_json::from_slice(bytes).unwrap())
            .unwrap_or(Value::Null);
        (request.url().to_string(), request.headers().clone(), body)
    }

    /// Feeds a fixture stream through the decoder and parser.
    pub fn run_fixture(id: ProviderId, fixture: &str) -> Result<(String, bool), AiError> {
        let provider = id.provider();
        let mut decoder = Decoder::new(provider.framing());
        let mut records = decoder.push(fixture.as_bytes());
        records.extend(decoder.finish());
        let mut text = String::new();
        for record in &records {
            let chunk = provider.parse_record(record)?;
            text.push_str(&chunk.text);
            if chunk.done {
                return Ok((text, true));
            }
        }
        Ok((text, false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_serialize_as_snake_case() {
        let ids: Vec<Value> = ProviderId::ALL
            .iter()
            .map(|id| serde_json::to_value(id).unwrap())
            .collect();
        assert_eq!(
            ids,
            vec![
                "anthropic",
                "openai",
                "gemini",
                "ollama",
                "openai_compatible"
            ]
        );
        for id in ProviderId::ALL {
            assert_eq!(serde_json::to_value(id).unwrap(), id.as_str());
        }
    }

    #[test]
    fn fixed_providers_cannot_change_their_url() {
        for id in ProviderId::ALL {
            if !id.base_url_editable() {
                assert!(id.default_base_url().is_some(), "{id:?}");
            }
        }
    }

    #[test]
    fn config_debug_hides_the_key() {
        let text = format!("{:?}", test_support::config(ProviderId::Openai));
        assert!(!text.contains("sk-test-123"));
        assert!(text.contains("has_key: true"));
    }

    #[test]
    fn classifies_http_errors() {
        assert_eq!(classify_http(401, ""), AiError::InvalidKey);
        assert_eq!(classify_http(429, "{}"), AiError::Quota);
        assert_eq!(classify_http(529, ""), AiError::Busy);
        assert_eq!(
            classify_http(
                400,
                r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#
            ),
            AiError::InvalidKey
        );
        assert_eq!(
            classify_http(
                400,
                r#"{"error":{"message":"This model does not support image input."}}"#
            ),
            AiError::NoVision
        );
        assert_eq!(
            classify_http(404, r#"{"error":"model 'llava' not found"}"#),
            AiError::ModelNotFound
        );
        assert_eq!(
            classify_http(404, "<html>nope</html>"),
            AiError::Provider("HTTP 404: <html>nope</html>".into())
        );
        assert_eq!(classify_http(500, ""), AiError::Provider("HTTP 500".into()));
    }

    #[test]
    fn truncates_long_messages_on_char_boundaries() {
        let long = "é".repeat(400);
        let message = truncate(&long, 300);
        assert_eq!(message.chars().count(), 301);
        assert!(message.ends_with('…'));
    }

    #[test]
    fn normalizes_base_urls() {
        assert_eq!(
            normalize_base_url(" https://openrouter.ai/api/v1/ ").unwrap(),
            "https://openrouter.ai/api/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:1234/v1").unwrap(),
            "http://localhost:1234/v1"
        );
        for bad in [
            "ftp://x.com",
            "openrouter.ai/api/v1",
            "https://user:pw@x.com/v1",
            "https://x.com/v1?key=abc",
            "",
        ] {
            assert!(normalize_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn validates_model_names() {
        assert_eq!(
            normalize_model(" meta-llama/llama-3.2-11b-vision:free ").unwrap(),
            "meta-llama/llama-3.2-11b-vision:free"
        );
        assert!(normalize_model("").is_err());
        assert!(normalize_model("two words").is_err());
        assert!(normalize_model("model?x=1").is_err());
    }
}
