//! Antigravity (Google subscription) over the Cloud Code Assist wire.
//!
//! `/v1internal:generateContent` takes the Gemini `generateContent` body
//! wrapped as `{ project, model, request: { ... } }` and answers with the
//! Gemini response wrapped as `{ response: { ... } }`. Requests need a
//! `Bearer` token from the Google login, the account's Cloud Code Assist
//! project (else 403 "no valid license"), and the Antigravity User-Agent
//! (else 403 "caller does not have permission").

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::oauth::antigravity::user_agent;
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

    let mut request = json!({
        "systemInstruction": { "parts": [{ "text": req.system }] },
        "contents": contents,
        "generationConfig": { "responseMimeType": "application/json" },
    });
    if req.structured {
        request["generationConfig"]["responseSchema"] = json!({
            "type": "OBJECT",
            "properties": {
                "type": { "type": "STRING" },
                "answer": { "type": "STRING" },
            },
            "required": ["type", "answer"],
        });
    }
    json!({
        "project": cfg.project.as_deref().unwrap_or_default(),
        "model": cfg.model,
        "userAgent": "antigravity",
        "requestId": format!("notch/{}", super::oauth::new_session_id()),
        "request": request,
    })
}

fn request(http: &Client, cfg: &ProviderConfig, body: Value) -> RequestBuilder {
    let token = cfg.key().unwrap_or_default();
    http.post(url(cfg))
        .header("user-agent", user_agent())
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

    /// Pulls the assistant text out of a wrapped `generateContent` response,
    /// skipping the model's "thought" parts.
    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        let inner = body.get("response").unwrap_or(body);
        let text = inner
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter(|part| {
                        !part
                            .get("thought")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
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
        .header("user-agent", user_agent())
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&json!({ "project": cfg.project.as_deref().unwrap_or_default() }))
    }

    /// Chat models only: they carry a quota reset time, while internal
    /// autocomplete/routing entries do not. Image models cannot answer.
    /// Gemini first, then Claude, then the rest; newest versions first.
    fn parse_models(&self, body: &Value) -> Vec<String> {
        let Some(models) = body.pointer("/models").and_then(Value::as_object) else {
            return Vec::new();
        };
        let mut chat: Vec<String> = models
            .iter()
            .filter(|(id, info)| {
                info.pointer("/quotaInfo/resetTime").is_some()
                    && !id.to_ascii_lowercase().contains("image")
            })
            .map(|(id, _)| id.clone())
            .collect();
        chat.sort_by(|a, b| {
            family(a)
                .cmp(&family(b))
                .then_with(|| natural_key(b).cmp(&natural_key(a)))
        });
        chat
    }

    fn keeps_model_order(&self) -> bool {
        true
    }
}

fn family(id: &str) -> u8 {
    if id.starts_with("gemini") {
        0
    } else if id.starts_with("claude") {
        1
    } else {
        2
    }
}

/// Splits an id into text and number runs so `gemini-3.10` sorts after `gemini-3.9`.
fn natural_key(id: &str) -> Vec<(String, u64)> {
    let mut key = Vec::new();
    let mut text = String::new();
    let mut digits = String::new();
    for c in id.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else {
            if !digits.is_empty() {
                key.push((std::mem::take(&mut text), digits.parse().unwrap_or(0)));
                digits.clear();
            }
            text.push(c);
        }
    }
    key.push((text, digits.parse().unwrap_or(0)));
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_chat_models_gemini_first_newest_first() {
        let body = json!({ "models": {
            "gemini-2.5-flash": { "quotaInfo": { "resetTime": "t" } },
            "gemini-3-flash": { "quotaInfo": { "resetTime": "t" } },
            "claude-sonnet-4-6": { "quotaInfo": { "resetTime": "t" } },
            "gemini-3.1-flash-image": { "quotaInfo": { "resetTime": "t" } },
            "tab_flash_lite_preview": {},
            "chat_20706": {}
        }});
        assert_eq!(
            Antigravity.parse_models(&body),
            vec!["gemini-3-flash", "gemini-2.5-flash", "claude-sonnet-4-6"]
        );
    }

    #[test]
    fn unwraps_the_response_and_skips_thoughts() {
        let body = json!({ "response": { "candidates": [{ "content": { "parts": [
            { "thought": true, "text": "" },
            { "text": "{\"type\":\"pg\",\"answer\":\"4\"}" }
        ]}}]}});
        assert_eq!(
            Antigravity.parse_complete(&body).unwrap(),
            "{\"type\":\"pg\",\"answer\":\"4\"}"
        );
    }
}
