//! Codex (ChatGPT subscription) over the OpenAI Responses wire.
//!
//! The ChatGPT backend serves Codex at `/backend-api/codex/responses`, which
//! speaks the Responses protocol: a top-level `instructions` string plus an
//! `input` array of `{ role, content: [{ type: "input_text", text }] }` items.
//! The answer comes back in `output` items of type `message` carrying
//! `output_text` parts.
//!
//! The access token is a `Bearer` credential; the account id rides the
//! `chatgpt-account-id` header, read from the token's JWT claims.

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::oauth::codex as oauth_codex;
use super::sse::Record;
use super::{AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message};

pub(crate) struct Codex;

fn url(cfg: &ProviderConfig) -> String {
    let base = cfg.base_url.trim_end_matches('/');
    format!("{base}/codex/responses")
}

fn body(cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
    let mut input = Vec::with_capacity(req.turns.len());
    for turn in req.turns {
        let mut content = Vec::new();
        if let Some(image) = &turn.image {
            content.push(json!({
                "type": "input_image",
                "image_url": format!("data:{};base64,{}", image.media_type, image.base64),
                "detail": "high",
            }));
        }
        content.push(json!({ "type": "input_text", "text": turn.text }));
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
        "stream": false,
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

fn request(http: &Client, cfg: &ProviderConfig, body: Value) -> RequestBuilder {
    let token = cfg.key().unwrap_or_default();
    let account = oauth_codex::account_id(token);
    let mut builder = http
        .post(url(cfg))
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("originator", "codex_cli_rs")
        .header("OpenAI-Beta", "responses=experimental")
        .json(&body);
    if let Some(account) = account {
        builder = builder.header("chatgpt-account-id", account);
    }
    builder
}

impl Provider for Codex {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        request(http, cfg, body(cfg, req))
    }

    fn parse_record(&self, _record: &Record) -> Result<Chunk, AiError> {
        Err(AiError::Provider("Codex does not stream here".into()))
    }

    /// Pulls the assistant text out of a Responses `output` array.
    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        let mut text = String::new();
        if let Some(output) = body.get("output").and_then(Value::as_array) {
            for item in output {
                if item.get("type").and_then(Value::as_str) != Some("message") {
                    continue;
                }
                if let Some(parts) = item.get("content").and_then(Value::as_array) {
                    for part in parts {
                        if part.get("type").and_then(Value::as_str) == Some("output_text")
                            && let Some(chunk) = part.get("text").and_then(Value::as_str)
                        {
                            text.push_str(chunk);
                        }
                    }
                }
            }
        }
        // Some responses carry a flat `output_text`.
        if text.is_empty()
            && let Some(flat) = body.get("output_text").and_then(Value::as_str)
        {
            text.push_str(flat);
        }
        if text.is_empty() {
            return Err(classify_message(""));
        }
        Ok(text)
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        let token = cfg.key().unwrap_or_default();
        let account = oauth_codex::account_id(token);
        let mut builder = http
            .get(format!(
                "{}/codex/models",
                cfg.base_url.trim_end_matches('/')
            ))
            .header("authorization", format!("Bearer {token}"))
            .header("accept", "application/json")
            .header("originator", "codex_cli_rs")
            .header("OpenAI-Beta", "responses=experimental");
        if let Some(account) = account {
            builder = builder.header("chatgpt-account-id", account);
        }
        builder
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        let Some(models) = body.get("models").and_then(Value::as_array) else {
            return Vec::new();
        };
        models
            .iter()
            .filter_map(|model| model.get("id").and_then(Value::as_str))
            .map(str::to_owned)
            .collect()
    }
}
