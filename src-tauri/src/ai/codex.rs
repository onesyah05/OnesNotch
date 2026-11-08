//! Codex (ChatGPT subscription) over the OpenAI Responses wire.
//!
//! The ChatGPT backend serves Codex at `/backend-api/codex/responses`, which
//! speaks the Responses protocol: a top-level `instructions` string plus an
//! `input` array of `{ role, content: [{ type: "input_text", text }] }` items.
//! The backend only answers streamed requests, so the answer arrives as
//! `response.output_text.delta` SSE events and ends with `response.completed`.
//!
//! The access token is a `Bearer` credential; the account id rides the
//! `chatgpt-account-id` header, read from the token's JWT claims. Requests
//! must look like the Codex CLI: the backend hides models (and rejects them as
//! `model_not_found`) when the reported client version is below a model's
//! minimum.

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::oauth::codex as oauth_codex;
use super::sse::Record;
use super::{AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role};

pub(crate) struct Codex;

/// Codex CLI version we report. Must stay at or above the newest model's
/// `minimal_client_version` (0.155.0 as of 2026-11).
const CLIENT_VERSION: &str = "0.160.0";
const ORIGINATOR: &str = "codex_cli_rs";

fn url(cfg: &ProviderConfig) -> String {
    let base = cfg.base_url.trim_end_matches('/');
    format!("{base}/codex/responses")
}

fn body(cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
    let mut input = Vec::with_capacity(req.turns.len());
    for turn in req.turns {
        let content = match turn.role {
            // Assistant turns only take `output_text` on the Responses wire.
            Role::Assistant => vec![json!({ "type": "output_text", "text": turn.text })],
            Role::User => {
                let mut content = Vec::new();
                if let Some(image) = &turn.image {
                    content.push(json!({
                        "type": "input_image",
                        "image_url": format!("data:{};base64,{}", image.media_type, image.base64),
                        "detail": "high",
                    }));
                }
                content.push(json!({ "type": "input_text", "text": turn.text }));
                content
            }
        };
        input.push(json!({
            "role": match turn.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            },
            "content": content,
        }));
    }

    let mut body = json!({
        "model": cfg.model,
        "instructions": req.system,
        "input": input,
        "stream": true,
        "store": false,
    });
    if req.structured {
        body["text"] = json!({
            "format": {
                "type": "json_schema",
                "name": "submit_answer",
                "schema": super::prompts::answer_schema(),
                "strict": true,
            }
        });
    }
    body
}

/// Headers the ChatGPT backend expects from the Codex CLI.
fn with_codex_headers(builder: RequestBuilder, cfg: &ProviderConfig) -> RequestBuilder {
    let token = cfg.key().unwrap_or_default();
    let mut builder = builder
        .header("authorization", format!("Bearer {token}"))
        .header("user-agent", format!("{ORIGINATOR}/{CLIENT_VERSION}"))
        .header("originator", ORIGINATOR)
        .header("version", CLIENT_VERSION);
    if let Some(account) = oauth_codex::account_id(token) {
        builder = builder.header("chatgpt-account-id", account);
    }
    builder
}

fn session_id() -> String {
    super::oauth::new_session_id()
}

impl Provider for Codex {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        let session = session_id();
        with_codex_headers(http.post(url(cfg)), cfg)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .header("OpenAI-Beta", "responses=experimental")
            .header("session_id", session.as_str())
            .header("conversation_id", session.as_str())
            .json(&body(cfg, req))
    }

    fn sse_only(&self) -> bool {
        true
    }

    /// One Responses SSE event: text deltas accumulate, `response.completed`
    /// ends the answer, and failures surface the provider's message.
    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError> {
        let data = record.data.trim();
        if data.is_empty() || data == "[DONE]" {
            return Ok(Chunk::skip());
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return Ok(Chunk::skip());
        };
        match event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "response.output_text.delta" => Ok(event
                .get("delta")
                .and_then(Value::as_str)
                .map_or_else(Chunk::skip, Chunk::text)),
            "response.completed" => Ok(Chunk::done()),
            "response.failed" | "error" => {
                let message = event
                    .pointer("/response/error/message")
                    .or_else(|| event.pointer("/error/message"))
                    .or_else(|| event.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Codex response failed");
                Err(super::classify_message(message))
            }
            _ => Ok(Chunk::skip()),
        }
    }

    /// Unused: Codex is [`Provider::sse_only`].
    fn parse_complete(&self, _body: &Value) -> Result<String, AiError> {
        Err(AiError::Provider(
            "Codex only answers streamed requests".into(),
        ))
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        let url = format!(
            "{}/codex/models?client_version={CLIENT_VERSION}",
            cfg.base_url.trim_end_matches('/')
        );
        with_codex_headers(http.get(url), cfg).header("accept", "application/json")
    }

    /// Visible models, best first by the backend's own `priority`.
    fn parse_models(&self, body: &Value) -> Vec<String> {
        let Some(models) = body.get("models").and_then(Value::as_array) else {
            return Vec::new();
        };
        let mut visible: Vec<(i64, String)> = models
            .iter()
            .filter(|model| model.get("visibility").and_then(Value::as_str) != Some("hide"))
            .filter_map(|model| {
                let slug = model
                    .get("slug")
                    .or_else(|| model.get("id"))
                    .and_then(Value::as_str)?;
                let priority = model.get("priority").and_then(Value::as_i64).unwrap_or(99);
                Some((priority, slug.to_owned()))
            })
            .collect();
        visible.sort_by_key(|(priority, _)| *priority);
        visible.into_iter().map(|(_, slug)| slug).collect()
    }

    fn keeps_model_order(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::ProviderId;
    use crate::ai::test_support::{config, conversation, inspect};

    #[test]
    fn requests_look_like_the_codex_cli_and_stream() {
        let cfg = config(ProviderId::Codex);
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 100,
            structured: true,
        };
        let (url, headers, body) = inspect(Codex.answer_request(&Client::new(), &cfg, &req));
        assert_eq!(url, "https://chatgpt.com/backend-api/codex/responses");
        assert_eq!(headers["originator"], "codex_cli_rs");
        assert_eq!(headers["version"], CLIENT_VERSION);
        assert_eq!(headers["accept"], "text/event-stream");
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["input"][1]["content"][0]["type"], "output_text");
    }

    #[test]
    fn parses_stream_events() {
        let record = |data: &str| Record {
            event: None,
            data: data.into(),
        };
        let delta = Codex
            .parse_record(&record(
                r#"{"type":"response.output_text.delta","delta":"Hi"}"#,
            ))
            .unwrap();
        assert_eq!(delta.text, "Hi");
        assert!(
            Codex
                .parse_record(&record(r#"{"type":"response.completed"}"#))
                .unwrap()
                .done
        );
        assert!(
            Codex
                .parse_record(&record("[DONE]"))
                .unwrap()
                .text
                .is_empty()
        );
        assert!(
            Codex
                .parse_record(&record(
                    r#"{"type":"response.failed","response":{"error":{"message":"boom"}}}"#
                ))
                .is_err()
        );
    }

    #[test]
    fn lists_visible_models_by_priority() {
        let body = json!({ "models": [
            { "slug": "gpt-6-luna", "priority": 3 },
            { "slug": "hidden", "visibility": "hide", "priority": 0 },
            { "slug": "gpt-6-sol", "priority": 1 },
        ]});
        assert_eq!(Codex.parse_models(&body), vec!["gpt-6-sol", "gpt-6-luna"]);
    }
}
