//! Antigravity (Google subscription) over the Cloud Code Assist wire.
//!
//! The Cloud Code Assist endpoint speaks the Gemini `generateContent` body at
//! `/v1internal:generateContent`, authenticated with a `Bearer` token from the
//! Google OAuth login. The account's Cloud Code Assist project id must ride
//! the request or the upstream rejects it with "no valid license".

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::sse::Record;
use super::{AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message};

pub(crate) struct Antigravity;

fn url(cfg: &ProviderConfig) -> String {
    format!(
        "{}/v1internal:generateContent",
        cfg.base_url.trim_end_matches('/')
    )
}

fn body(cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
    let contents: Vec<Value> = req
        .turns
        .iter()
        .map(|turn| {
            let mut parts = Vec::new();
            if let Some(image) = &turn.image {
                parts.push(json!({
                    "inlineData": { "mimeType": image.media_type, "data": image.base64 },
                }));
            }
            parts.push(json!({ "text": turn.text }));
            json!({
                "role": match turn.role {
                    Role::User => "user",
                    Role::Assistant => "model",
                },
                "parts": parts,
            })
        })
        .collect();

    let mut body = json!({
        "model": cfg.model,
        "systemInstruction": { "parts": [{ "text": req.system }] },
        "contents": contents,
        "generationConfig": { "responseMimeType": "application/json" },
    });
    if req.structured {
        body["generationConfig"]["responseSchema"] = json!({
            "type": "OBJECT",
            "properties": {
                "type": { "type": "STRING" },
                "answer": { "type": "STRING" },
            },
            "required": ["type", "answer"],
        });
    }
    body
}

fn request(http: &Client, cfg: &ProviderConfig, body: Value) -> RequestBuilder {
    let token = cfg.key().unwrap_or_default();
    http.post(url(cfg))
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&body)
}

impl Provider for Antigravity {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        request(http, cfg, body(cfg, req))
    }

    fn parse_record(&self, _record: &Record) -> Result<Chunk, AiError> {
        Err(AiError::Provider("Antigravity does not stream here".into()))
    }

    /// Pulls the assistant text out of a `generateContent` response.
    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        let text = body
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        if text.is_empty() {
            return Err(classify_message(""));
        }
        Ok(text)
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        let token = cfg.key().unwrap_or_default();
        http.post(format!(
            "{}/v1internal:fetchAvailableModels",
            cfg.base_url.trim_end_matches('/')
        ))
        .timeout(super::MODELS_TIMEOUT)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&json!({}))
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        let Some(models) = body.pointer("/models").and_then(Value::as_object) else {
            return Vec::new();
        };
        models.keys().cloned().collect()
    }
}
