//! Google Gemini `generateContent` (JSON body, non-streaming).

use reqwest::{Client, RequestBuilder, Url};
use serde_json::{Value, json};

use super::sse::Record;
use super::{AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message};

pub(crate) struct Gemini;

/// Builds `{base}/models/{model}:generateContent` with the model as one
/// escaped path segment.
fn generate_url(cfg: &ProviderConfig) -> String {
    let model = cfg.model.strip_prefix("models/").unwrap_or(&cfg.model);
    let segment = format!("{model}:generateContent");
    match Url::parse(&cfg.base_url) {
        Ok(mut url) => {
            if let Ok(mut segments) = url.path_segments_mut() {
                segments.pop_if_empty().push("models").push(&segment);
            }
            url.to_string()
        }
        Err(_) => format!("{}/models/{segment}", cfg.base_url),
    }
}

fn body(req: &AnswerRequest<'_>) -> Value {
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

    let mut generation = json!({ "responseMimeType": "application/json" });
    if req.structured {
        // Gemini's OpenAPI subset: no `additionalProperties`; ordering keeps
        // `type` before `answer` so the model commits to a layout first.
        generation["responseSchema"] = json!({
            "type": "OBJECT",
            "properties": {
                "type": { "type": "STRING", "enum": ["pg", "essay"] },
                "answer": { "type": "STRING" },
            },
            "required": ["type", "answer"],
            "propertyOrdering": ["type", "answer"],
        });
    }

    // No `maxOutputTokens`: thinking models count thoughts against it, and a
    // tight cap can end the answer before any visible text.
    json!({
        "systemInstruction": { "parts": [{ "text": req.system }] },
        "contents": contents,
        "generationConfig": generation,
    })
}

fn with_auth(builder: RequestBuilder, cfg: &ProviderConfig) -> RequestBuilder {
    // The header keeps the key out of URLs (and out of any URL-bearing error).
    builder.header("x-goog-api-key", cfg.key().unwrap_or_default())
}

impl Provider for Gemini {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        with_auth(http.post(generate_url(cfg)), cfg).json(&body(req))
    }

    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError> {
        let Ok(json) = serde_json::from_str::<Value>(&record.data) else {
            return Ok(Chunk::skip());
        };
        if let Some(error) = json.get("error") {
            return Err(classify_message(
                error["message"].as_str().unwrap_or("unknown error"),
            ));
        }
        if let Some(reason) = json
            .pointer("/promptFeedback/blockReason")
            .and_then(Value::as_str)
        {
            return Err(AiError::Provider(format!(
                "blocked by the provider: {reason}"
            )));
        }

        let text: String = json
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|part| part["thought"] != true)
            .filter_map(|part| part["text"].as_str())
            .collect();
        Ok(Chunk::text(text))
    }

    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        if let Some(error) = body.get("error") {
            return Err(classify_message(
                error["message"].as_str().unwrap_or("unknown error"),
            ));
        }
        if let Some(reason) = body
            .pointer("/promptFeedback/blockReason")
            .and_then(Value::as_str)
        {
            return Err(AiError::Provider(format!(
                "blocked by the provider: {reason}"
            )));
        }
        let text: String = body
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|part| part["thought"] != true)
            .filter_map(|part| part["text"].as_str())
            .collect();
        Ok(text)
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        with_auth(
            http.get(format!("{}/models?pageSize=1000", cfg.base_url)),
            cfg,
        )
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        body["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|model| {
                model["supportedGenerationMethods"]
                    .as_array()
                    .is_some_and(|methods| methods.iter().any(|m| m == "generateContent"))
            })
            .filter_map(|model| model["name"].as_str())
            .map(|name| name.strip_prefix("models/").unwrap_or(name).to_owned())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{config, conversation, inspect, run_fixture};
    use super::super::{AnswerRequest, ProviderId};
    use super::*;

    const FIXTURE: &str = concat!(
        "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"thinking...\", \"thought\": true}],\"role\": \"model\"}}]}\r\n\r\n",
        "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"Jawaban: \"}],\"role\": \"model\"},\"index\": 0}]}\r\n\r\n",
        "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"A\"}],\"role\": \"model\"},\"finishReason\": \"STOP\",\"index\": 0}],\"usageMetadata\": {\"totalTokenCount\": 10}}\r\n\r\n",
    );

    #[test]
    fn streams_visible_text_and_skips_thoughts() {
        let (text, done) = run_fixture(ProviderId::Gemini, FIXTURE).unwrap();
        assert_eq!(text, "Jawaban: A");
        assert!(!done, "Gemini ends by closing the stream");
    }

    #[test]
    fn reports_blocked_prompts() {
        let fixture = "data: {\"promptFeedback\": {\"blockReason\": \"SAFETY\"}}\n\n";
        assert!(matches!(
            run_fixture(ProviderId::Gemini, fixture),
            Err(AiError::Provider(message)) if message.contains("SAFETY")
        ));
    }

    #[test]
    fn builds_request_with_key_in_header_not_url() {
        let mut cfg = config(ProviderId::Gemini);
        cfg.model = "models/gemini-flash-latest".into();
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 1024,
            structured: true,
        };
        let (url, headers, body) = inspect(Gemini.answer_request(&Client::new(), &cfg, &req));

        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
        );
        assert!(!url.contains("sk-test-123"));
        assert_eq!(headers["x-goog-api-key"], "sk-test-123");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "sys");
        assert_eq!(
            body["generationConfig"]["responseMimeType"],
            "application/json"
        );
        assert_eq!(
            body["generationConfig"]["responseSchema"]["required"],
            json!(["type", "answer"])
        );
        assert_eq!(
            body["contents"][0]["parts"][0]["inlineData"]["data"],
            "QUJD"
        );
        assert_eq!(body["contents"][1]["role"], "model");
    }

    #[test]
    fn escapes_odd_model_names() {
        let mut cfg = config(ProviderId::Gemini);
        cfg.model = "a/b".into();
        assert!(generate_url(&cfg).contains("/models/a%2Fb:generateContent"));
    }

    #[test]
    fn lists_only_generate_content_models() {
        let body = json!({ "models": [
            { "name": "models/gemini-flash-latest", "supportedGenerationMethods": ["generateContent", "countTokens"] },
            { "name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"] }
        ]});
        assert_eq!(Gemini.parse_models(&body), vec!["gemini-flash-latest"]);
    }

    #[test]
    fn parse_complete_skips_thoughts() {
        let body = json!({
            "candidates": [{
                "content": { "parts": [
                    { "text": "thinking", "thought": true },
                    { "text": "{\"kind\":\"mcq\",\"choices\":[{\"q\":\"3\",\"a\":\"C\"}]}" }
                ] }
            }]
        });
        assert_eq!(
            Gemini.parse_complete(&body).unwrap(),
            "{\"kind\":\"mcq\",\"choices\":[{\"q\":\"3\",\"a\":\"C\"}]}"
        );
    }
}
