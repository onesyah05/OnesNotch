//! Ollama native chat API (`/api/chat`), JSON body, non-streaming. No API key.

use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

use super::sse::{Framing, Record};
use super::{
    AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message, prompts,
};

pub(crate) struct Ollama;

fn body(cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
    let mut messages = vec![json!({ "role": "system", "content": req.system })];
    for turn in req.turns {
        let mut message = json!({
            "role": match turn.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            },
            "content": turn.text,
        });
        if let Some(image) = &turn.image {
            message["images"] = json!([image.base64]);
        }
        messages.push(message);
    }
    let format = if req.structured {
        prompts::answer_schema()
    } else {
        json!("json")
    };
    json!({
        "model": cfg.model,
        "stream": false,
        "format": format,
        "messages": messages,
        "options": { "num_predict": req.max_tokens },
    })
}

impl Provider for Ollama {
    fn framing(&self) -> Framing {
        Framing::NdJson
    }

    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        http.post(format!("{}/api/chat", cfg.base_url))
            .json(&body(cfg, req))
    }

    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError> {
        let Ok(json) = serde_json::from_str::<Value>(&record.data) else {
            return Ok(Chunk::skip());
        };
        if let Some(error) = json["error"].as_str() {
            return Err(classify_message(error));
        }
        Ok(Chunk {
            text: json
                .pointer("/message/content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            done: json["done"] == true,
        })
    }

    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        if let Some(error) = body["error"].as_str() {
            return Err(classify_message(error));
        }
        Ok(body
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        http.get(format!("{}/api/tags", cfg.base_url))
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        body["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|model| model["name"].as_str().map(str::to_owned))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{config, conversation, inspect, run_fixture};
    use super::super::{AnswerRequest, ProviderId};
    use super::*;

    const FIXTURE: &str = concat!(
        "{\"model\":\"gemma3\",\"created_at\":\"2026-10-26T00:00:00Z\",\"message\":{\"role\":\"assistant\",\"content\":\"Answer\"},\"done\":false}\n",
        "{\"model\":\"gemma3\",\"message\":{\"role\":\"assistant\",\"content\":\": D\"},\"done\":false}\n",
        "{\"model\":\"gemma3\",\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"done_reason\":\"stop\",\"eval_count\":3}\n",
    );

    #[test]
    fn streams_ndjson_until_done() {
        let (text, done) = run_fixture(ProviderId::Ollama, FIXTURE).unwrap();
        assert_eq!(text, "Answer: D");
        assert!(done);
    }

    #[test]
    fn maps_missing_models() {
        let fixture = "{\"error\":\"model \\\"llava\\\" not found, try pulling it first\"}\n";
        assert_eq!(
            run_fixture(ProviderId::Ollama, fixture),
            Err(AiError::ModelNotFound)
        );
    }

    #[test]
    fn builds_request_with_images_and_no_auth() {
        let cfg = config(ProviderId::Ollama);
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 256,
            structured: true,
        };
        let (url, headers, body) = inspect(Ollama.answer_request(&Client::new(), &cfg, &req));

        assert_eq!(url, "http://localhost:11434/api/chat");
        assert!(headers.get("authorization").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["images"][0], "QUJD");
        assert!(body["messages"][2].get("images").is_none());
        assert_eq!(body["options"]["num_predict"], 256);
        assert_eq!(body["stream"], false);
        assert_eq!(body["format"], prompts::answer_schema());
    }

    #[test]
    fn parse_complete_reads_message_content() {
        let body = json!({
            "message": { "role": "assistant", "content": "{\"kind\":\"text\",\"text\":\"ok\"}" },
            "done": true
        });
        assert_eq!(
            Ollama.parse_complete(&body).unwrap(),
            "{\"kind\":\"text\",\"text\":\"ok\"}"
        );
    }

    #[test]
    fn parses_tags() {
        let body = json!({ "models": [{ "name": "gemma3:latest" }, { "name": "qwen2.5vl:7b" }] });
        assert_eq!(
            Ollama.parse_models(&body),
            vec!["gemma3:latest", "qwen2.5vl:7b"]
        );
    }
}
