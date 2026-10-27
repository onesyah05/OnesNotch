//! OpenAI Chat Completions (JSON body, non-streaming).
//!
//! Shared by the official OpenAI provider (fixed base URL) and the
//! OpenAI-compatible provider (OpenRouter, Groq, LM Studio, vLLM, ...).
//! The parser is deliberately loose: unknown fields are ignored and the
//! trailing `[DONE]` is optional.

use reqwest::{Client, RequestBuilder};
use serde_json::{Map, Value, json};

use super::sse::Record;
use super::{
    AiError, AnswerRequest, Chunk, Provider, ProviderConfig, Role, classify_message, prompts,
};

pub(crate) struct OpenAi {
    /// The official API gets `max_completion_tokens` and image `detail`;
    /// compatible servers get the older, more widely accepted fields.
    pub official: bool,
}

/// Model families that make sense for screenshot answers.
const OFFICIAL_PREFIXES: [&str; 4] = ["gpt-", "chatgpt-", "o3", "o4"];
const OFFICIAL_EXCLUDED: [&str; 9] = [
    "audio",
    "realtime",
    "tts",
    "transcribe",
    "embedding",
    "image",
    "search",
    "moderation",
    "instruct",
];

impl OpenAi {
    fn body(&self, cfg: &ProviderConfig, req: &AnswerRequest<'_>) -> Value {
        let mut messages = vec![json!({ "role": "system", "content": req.system })];
        for turn in req.turns {
            let role = match turn.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            let content = match &turn.image {
                Some(image) => {
                    let mut image_url = Map::new();
                    image_url.insert(
                        "url".into(),
                        format!("data:{};base64,{}", image.media_type, image.base64).into(),
                    );
                    if self.official {
                        // Small on-screen text needs the high-detail tiles.
                        image_url.insert("detail".into(), "high".into());
                    }
                    json!([
                        { "type": "text", "text": turn.text },
                        { "type": "image_url", "image_url": image_url },
                    ])
                }
                None => Value::String(turn.text.clone()),
            };
            messages.push(json!({ "role": role, "content": content }));
        }

        let tokens_field = if self.official {
            "max_completion_tokens"
        } else {
            "max_tokens"
        };
        let mut body = json!({
            "model": cfg.model,
            "stream": false,
            "messages": messages,
            tokens_field: req.max_tokens,
        });
        if req.structured {
            body["response_format"] = json!({
                "type": "json_schema",
                "json_schema": {
                    "name": "notch_answer",
                    "strict": true,
                    "schema": prompts::answer_schema(),
                },
            });
        }
        body
    }
}

fn with_auth(builder: RequestBuilder, cfg: &ProviderConfig) -> RequestBuilder {
    match cfg.key() {
        Some(key) => builder.bearer_auth(key),
        None => builder,
    }
}

impl Provider for OpenAi {
    fn answer_request(
        &self,
        http: &Client,
        cfg: &ProviderConfig,
        req: &AnswerRequest<'_>,
    ) -> RequestBuilder {
        with_auth(http.post(format!("{}/chat/completions", cfg.base_url)), cfg)
            .json(&self.body(cfg, req))
    }

    fn parse_record(&self, record: &Record) -> Result<Chunk, AiError> {
        let data = record.data.trim();
        if data == "[DONE]" {
            return Ok(Chunk::done());
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            return Ok(Chunk::skip());
        };
        if let Some(error) = json.get("error") {
            let message = error["message"]
                .as_str()
                .or_else(|| error.as_str())
                .unwrap_or("unknown error");
            return Err(classify_message(message));
        }
        let text = json
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        Ok(Chunk::text(text))
    }

    fn parse_complete(&self, body: &Value) -> Result<String, AiError> {
        if let Some(error) = body.get("error") {
            let message = error["message"]
                .as_str()
                .or_else(|| error.as_str())
                .unwrap_or("unknown error");
            return Err(classify_message(message));
        }
        Ok(body
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    fn models_request(&self, http: &Client, cfg: &ProviderConfig) -> RequestBuilder {
        with_auth(http.get(format!("{}/models", cfg.base_url)), cfg)
    }

    fn parse_models(&self, body: &Value) -> Vec<String> {
        body["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|model| model["id"].as_str())
            .filter(|id| {
                !self.official
                    || (OFFICIAL_PREFIXES
                        .iter()
                        .any(|prefix| id.starts_with(prefix))
                        && !OFFICIAL_EXCLUDED.iter().any(|word| id.contains(word)))
            })
            .map(str::to_owned)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{config, conversation, inspect, run_fixture};
    use super::super::{AnswerRequest, ProviderId};
    use super::*;

    const FIXTURE: &str = concat!(
        "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Answer: \"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"C\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    #[test]
    fn streams_until_done() {
        let (text, done) = run_fixture(ProviderId::Openai, FIXTURE).unwrap();
        assert_eq!(text, "Answer: C");
        assert!(done);
    }

    #[test]
    fn tolerates_compatible_server_quirks() {
        // OpenRouter-style comments, extra fields, reasoning deltas, and no [DONE].
        let fixture = concat!(
            ": OPENROUTER PROCESSING\n\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"hmm\"}}],\"provider\":\"x\"}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"},\"logprobs\":null}],\"usage\":null}\n\n",
            "data: {\"choices\":[],\"usage\":{\"total_tokens\":5}}\n\n",
            "data: not json at all\n\n",
        );
        let (text, done) = run_fixture(ProviderId::OpenaiCompatible, fixture).unwrap();
        assert_eq!(text, "Hi");
        assert!(!done);
    }

    #[test]
    fn surfaces_in_stream_errors() {
        let fixture = "data: {\"error\":{\"message\":\"Rate limit reached for requests\"}}\n\n";
        assert_eq!(
            run_fixture(ProviderId::OpenaiCompatible, fixture),
            Err(AiError::Quota)
        );
    }

    #[test]
    fn official_request_uses_new_fields() {
        let cfg = config(ProviderId::Openai);
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 2048,
            structured: true,
        };
        let provider = OpenAi { official: true };
        let (url, headers, body) = inspect(provider.answer_request(&Client::new(), &cfg, &req));

        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(headers["authorization"], "Bearer sk-test-123");
        assert_eq!(body["max_completion_tokens"], 2048);
        assert_eq!(body["stream"], false);
        assert_eq!(body["response_format"]["type"], "json_schema");
        assert_eq!(
            body["response_format"]["json_schema"]["schema"],
            prompts::answer_schema()
        );
        assert!(body.get("max_tokens").is_none());
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["role"], "system");
        let image = &messages[1]["content"][1]["image_url"];
        assert_eq!(image["url"], "data:image/jpeg;base64,QUJD");
        assert_eq!(image["detail"], "high");
        assert_eq!(messages[2]["content"], "Jawaban: B");
    }

    #[test]
    fn compatible_request_goes_only_to_the_configured_host() {
        let mut cfg = config(ProviderId::OpenaiCompatible);
        cfg.base_url = "http://localhost:1234/v1".into();
        cfg.api_key = None;
        let turns = conversation();
        let req = AnswerRequest {
            system: "sys",
            turns: &turns,
            max_tokens: 512,
            structured: false,
        };
        let provider = OpenAi { official: false };
        let (url, headers, body) = inspect(provider.answer_request(&Client::new(), &cfg, &req));

        assert_eq!(url, "http://localhost:1234/v1/chat/completions");
        assert!(headers.get("authorization").is_none(), "no key, no header");
        assert_eq!(body["max_tokens"], 512);
        assert_eq!(body["stream"], false);
        assert!(body.get("response_format").is_none());
        assert!(
            body["messages"][1]["content"][1]["image_url"]
                .get("detail")
                .is_none()
        );
    }

    #[test]
    fn filters_official_model_list() {
        let body = json!({ "data": [
            { "id": "gpt-5.2" }, { "id": "gpt-4o-audio-preview" }, { "id": "text-embedding-3-large" },
            { "id": "o4-mini" }, { "id": "dall-e-3" }
        ]});
        assert_eq!(
            OpenAi { official: true }.parse_models(&body),
            vec!["gpt-5.2", "o4-mini"]
        );
        assert_eq!(OpenAi { official: false }.parse_models(&body).len(), 5);
    }

    #[test]
    fn parse_complete_reads_message_content() {
        let body = json!({
            "choices": [{ "message": { "role": "assistant", "content": "{\"kind\":\"mcq\",\"choices\":[{\"q\":\"3\",\"a\":\"C\"}]}" } }]
        });
        assert_eq!(
            OpenAi { official: true }.parse_complete(&body).unwrap(),
            "{\"kind\":\"mcq\",\"choices\":[{\"q\":\"3\",\"a\":\"C\"}]}"
        );
    }
}
