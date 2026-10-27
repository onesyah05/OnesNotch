//! Anthropic Messages API (JSON body, non-streaming).

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::sse::Record;
use super::{
    AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message, prompts,
};

const API_VERSION: &str = "2023-06-01";
/// Forced tool whose input is the answer JSON.
const ANSWER_TOOL: &str = "submit_answer";

pub(crate) struct Anthropic;

fn body(cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
    let messages: Vec<Value> = req
        .turns
        .iter()
        .map(|turn| {
            let mut content = Vec::new();
            if let Some(image) = &turn.image {
                content.push(json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.media_type,
                        "data": image.base64,
                    },
                }));
            }
            content.push(json!({ "type": "text", "text": turn.text }));
            json!({
                "role": match turn.role {
                    Role::User => "user",
                    Role::Assistant => "assistant",
                },
                "content": content,
            })
        })
        .collect();

    let mut body = json!({
        "model": cfg.model,
        "max_tokens": req.max_tokens,
        "stream": false,
        "system": req.system,
        "messages": messages,
    });
    if req.structured {
        // A forced tool call is the one structured-output path every Claude
        // model accepts; its input is validated against the schema.
        body["tools"] = json!([{
            "name": ANSWER_TOOL,
            "description": "Submit the answer shown in the notch.",
            "input_schema": prompts::answer_schema(),
        }]);
        body["tool_choice"] = json!({ "type": "tool", "name": ANSWER_TOOL });
    }
    body
}

fn with_auth(builder: RequestBuilder, cfg: &ProviderConfig) -> RequestBuilder {
    builder
        .header("x-api-key", cfg.key().unwrap_or_default())
        .header("anthropic-version", API_VERSION)
}

impl Provider for Anthropic {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        with_auth(http.post(format!("{}/v1/messages", cfg.base_url)), cfg).json(&body(cfg, req))
    }

    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError> {
        let Ok(json) = serde_json::from_str::<Value>(&record.data) else {
            return Ok(Chunk::skip());
        };
        match json.get("type").and_then(Value::as_str) {
            Some("content_block_delta") => {
                let delta = &json["delta"];
                if delta["type"] == "text_delta"
                    && let Some(text) = delta["text"].as_str()
                {
                    return Ok(Chunk::text(text));
                }
                // Thinking and tool deltas are not shown.
                Ok(Chunk::skip())
            }
            Some("message_stop") => Ok(Chunk::done()),
            Some("error") => {
                let error = &json["error"];
                let message = error["message"].as_str().unwrap_or_default();
                Err(match error["type"].as_str() {
                    Some("authentication_error" | "permission_error") => AiError::InvalidKey,
                    Some("rate_limit_error") => AiError::Quota,
                    Some("overloaded_error") => AiError::Busy,
                    Some("not_found_error") => AiError::ModelNotFound,
                    _ => classify_message(message),
                })
            }
            _ => Ok(Chunk::skip()),
        }
    }

    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        if body.get("type").and_then(Value::as_str) == Some("error") {
            let error = &body["error"];
            let message = error["message"].as_str().unwrap_or_default();
            return Err(match error["type"].as_str() {
                Some("authentication_error" | "permission_error") => AiError::InvalidKey,
                Some("rate_limit_error") => AiError::Quota,
                Some("overloaded_error") => AiError::Busy,
                Some("not_found_error") => AiError::ModelNotFound,
                _ => classify_message(message),
            });
        }
        let blocks = body["content"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if let Some(input) = blocks
            .iter()
            .find(|block| block["type"] == "tool_use" && block["name"] == ANSWER_TOOL)
            .map(|block| &block["input"])
        {
            return Ok(input.to_string());
        }
        let text = blocks
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<String>();
        Ok(text)
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        with_auth(
            http.get(format!("{}/v1/models?limit=1000", cfg.base_url)),
            cfg,
        )
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        body["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|model| model["id"].as_str().map(str::to_owned))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{config, conversation, inspect, run_fixture};
    use super::super::{AnswerRequest, ProviderId};
    use super::*;

    const FIXTURE: &str = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"role\":\"assistant\",\"content\":[]}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: ping\n",
        "data: {\"type\": \"ping\"}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Jawaban: B\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"\\nKarena...\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":9}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );

    #[test]
    fn streams_text_deltas_until_message_stop() {
        let (text, done) = run_fixture(ProviderId::Anthropic, FIXTURE).unwrap();
        assert_eq!(text, "Jawaban: B\nKarena...");
        assert!(done);
    }

    #[test]
    fn maps_stream_errors() {
        let overloaded = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";
        assert_eq!(
            run_fixture(ProviderId::Anthropic, overloaded),
            Err(AiError::Busy)
        );
    }

    #[test]
    fn builds_a_vision_request() {
        let cfg = config(ProviderId::Anthropic);
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 1024,
            structured: true,
        };
        let (url, headers, body) = inspect(Anthropic.answer_request(&Client::new(), &cfg, &req));

        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert_eq!(headers["x-api-key"], "sk-test-123");
        assert_eq!(headers["anthropic-version"], API_VERSION);
        assert_eq!(body["model"], "test-model");
        assert_eq!(body["system"], "sys");
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_tokens"], 1024);
        assert_eq!(body["tools"][0]["name"], ANSWER_TOOL);
        assert_eq!(body["tools"][0]["input_schema"], prompts::answer_schema());
        assert_eq!(body["tool_choice"]["name"], ANSWER_TOOL);

        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"][0]["type"], "image");
        assert_eq!(messages[0]["content"][0]["source"]["data"], "QUJD");
        assert_eq!(
            messages[0]["content"][0]["source"]["media_type"],
            "image/jpeg"
        );
        assert_eq!(messages[0]["content"][1]["type"], "text");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[2]["content"][0]["text"], "Why not C?");
    }

    #[test]
    fn parses_model_list() {
        let body = json!({ "data": [{ "id": "claude-sonnet-5-5" }, { "id": "claude-haiku-5-5" }] });
        assert_eq!(
            Anthropic.parse_models(&body),
            vec!["claude-sonnet-5-5", "claude-haiku-5-5"]
        );
    }

    #[test]
    fn parse_complete_concatenates_text_blocks() {
        let body = json!({
            "content": [
                { "type": "text", "text": "{\"type\":\"pg\"," },
                { "type": "text", "text": "\"answer\":\"3. C\"}" }
            ]
        });
        assert_eq!(
            Anthropic.parse_complete(&body).unwrap(),
            "{\"type\":\"pg\",\"answer\":\"3. C\"}"
        );
    }

    #[test]
    fn parse_complete_prefers_the_answer_tool() {
        let body = json!({
            "content": [
                { "type": "text", "text": "Here you go" },
                { "type": "tool_use", "id": "t1", "name": ANSWER_TOOL,
                  "input": { "type": "pg", "answer": "3. C | 4. D" } }
            ],
            "stop_reason": "tool_use"
        });
        let raw = Anthropic.parse_complete(&body).unwrap();
        let answer = prompts::parse_answer(&raw);
        assert_eq!(answer.kind, prompts::AnswerKind::Pg);
        assert_eq!(answer.text, "3. C | 4. D");
    }
}
