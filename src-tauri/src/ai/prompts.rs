//! Every prompt the app sends lives here (AGENTS.md).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::capture::CaptureTarget;

/// Output cap per answer. Long enough for full code solutions in essays.
pub const MAX_TOKENS: u32 = 4096;

/// UI language, used only when the screen gives no language to follow.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    #[default]
    En,
    Id,
}

impl UiLanguage {
    const fn name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Id => "Indonesian",
        }
    }
}

/// How the notch lays out an answer. Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerKind {
    /// Multiple choice: a one-line pill such as `3. C | 4. D`.
    Pg,
    /// Everything else: a wider panel with markdown.
    Essay,
}

/// The model's answer after parsing. Not `Debug`: it holds answer text (rule 9).
#[derive(Clone, PartialEq, Eq)]
pub struct ParsedAnswer {
    pub kind: AnswerKind,
    pub text: String,
}

impl ParsedAnswer {
    /// Canonical JSON kept in the conversation, so follow-ups see replies in
    /// the same shape they are asked to produce.
    pub fn to_turn_text(&self) -> String {
        json!({ "type": self.kind, "answer": self.text }).to_string()
    }
}

/// JSON Schema for the answer, for providers that enforce structured output.
/// Kept to the subset every provider accepts (no `$ref`, no `oneOf`).
pub fn answer_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "type": { "type": "string", "enum": ["pg", "essay"] },
            "answer": { "type": "string" },
        },
        "required": ["type", "answer"],
        "additionalProperties": false,
    })
}

/// System prompt for screenshot answers. The reply is JSON only;
/// [`parse_answer`] turns it into what the notch shows.
pub fn system_prompt(target: CaptureTarget, ui: UiLanguage) -> String {
    let source = match target {
        CaptureTarget::Screen => "the user's screen",
        CaptureTarget::Window => "the user's active window",
    };
    let fallback = ui.name();
    format!(
        "You are Notch, a quiet on-screen answer assistant. Each conversation starts with a screenshot of {source}. \
Find the questions on it and ANSWER them directly.

CRITICAL RULES:
- Never describe, summarize, or transcribe what is visible on the screen.
- Do NOT say things like 'Based on the image...', 'You are looking at...', 'Here is the text...', or repeat the questions.
- JUMP DIRECTLY TO THE ANSWERS.

Reply with exactly one JSON object and nothing else (no markdown fences, no text before or after):
{{\"type\": \"pg\" | \"essay\", \"answer\": \"...\"}}

type \"pg\" — the visible questions are multiple choice (pilihan ganda) with options like A, B, C, D (or a, b, c, d).
answer = ONLY the question numbers and correct option letters in screen order, joined by \" | \".
Example: {{\"type\":\"pg\",\"answer\":\"3. C | 4. D | 5. A\"}}
Without a visible number, just the letter: {{\"type\":\"pg\",\"answer\":\"B\"}}
Never add option text, explanations, or question transcriptions.

type \"essay\" — essays, short answers, coding, math, or anything that is not multiple choice.
answer = the actual answer in Markdown, brief and direct. Several questions: a numbered list matching their numbers. \
Coding: a fenced code block, then one short note. Math: brief working, then the final answer in bold.

General rules:
- Language of the answer follows the question; if unclear, use {fallback}.
- Answer every visible question, including ones partly cut off if they can still be answered.
- Ignore browser chrome, tabs, URLs, and this overlay.
- If the text is unreadable, use type \"essay\" and say so in one sentence.
- Follow-up messages are about the same screenshot; reply with the same JSON shape."
    )
}

/// First user message that accompanies the screenshot.
pub fn initial_request(target: CaptureTarget) -> &'static str {
    match target {
        CaptureTarget::Screen => "Answer the questions on my screen. JSON only.",
        CaptureTarget::Window => "Answer the questions in this window. JSON only.",
    }
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type", alias = "kind")]
    kind: Option<String>,
    answer: Option<Value>,
    /// Older shapes some models still produce.
    text: Option<String>,
    choices: Option<Vec<Choice>>,
}

#[derive(Deserialize)]
struct Choice {
    q: Value,
    a: String,
}

/// Turns the model's reply (strict JSON, or JSON wrapped in prose/fences)
/// into what the UI shows. Anything unparseable is shown as an essay.
pub fn parse_answer(raw: &str) -> ParsedAnswer {
    let essay = |text: &str| ParsedAnswer {
        kind: AnswerKind::Essay,
        text: text.trim().to_owned(),
    };
    let Some(json_str) = extract_json(raw) else {
        return essay(raw);
    };
    let Ok(val) = serde_json::from_str::<Value>(json_str) else {
        return essay(raw);
    };

    // 1. Direct key-value map, e.g. {"6":"c","7":"c","8":"c"} or {"1":"Pengertian..."}
    if let Value::Object(ref map) = val
        && !map.contains_key("type")
        && !map.contains_key("kind")
        && !map.contains_key("answer")
        && !map.contains_key("text")
    {
        if let Some(items) = try_parse_kv_map(map) {
            return pg(items);
        }
        let essay_text = format_essay_map(map);
        if !essay_text.is_empty() {
            return essay(&essay_text);
        }
    }

    // 2. Standard Payload shape
    let Ok(payload) = serde_json::from_value::<Payload>(val.clone()) else {
        if let Value::Object(ref map) = val {
            let essay_text = format_essay_map(map);
            if !essay_text.is_empty() {
                return essay(&essay_text);
            }
        }
        return essay(raw);
    };

    let is_pg = matches!(
        payload
            .kind
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("pg" | "mcq" | "multiple_choice" | "choice")
    );

    if let Some(choices) = payload.choices.filter(|c| !c.is_empty()) {
        let items = choices
            .iter()
            .map(|c| format_choice(&value_text(&c.q), &c.a))
            .collect::<Vec<_>>();
        return pg(items);
    }

    // Check if `answer` is a map (e.g. {"type":"pg","answer":{"6":"c","7":"c"}} or {"type":"essay","answer":{"1":"..."}})
    if let Some(Value::Object(ref map)) = payload.answer {
        if let Some(items) = try_parse_kv_map(map) {
            return pg(items);
        }
        let essay_text = format_essay_map(map);
        if !essay_text.is_empty() {
            return essay(&essay_text);
        }
    }

    // Check if `answer` is an Array (e.g. ["6. C", "7. C"])
    if let Some(Value::Array(ref items)) = payload.answer {
        let string_items: Vec<String> = items.iter().map(value_text).collect();
        if is_pg || looks_like_pg_items(&string_items) {
            return pg(string_items);
        }
        return essay(&string_items.join("\n"));
    }

    let text = match payload.answer {
        Some(value) => value_text(&value),
        None => payload.text.unwrap_or_default(),
    };
    let text_trimmed = text.trim();
    if text_trimmed.is_empty() {
        if let Value::Object(ref map) = val {
            let essay_text = format_essay_map(map);
            if !essay_text.is_empty() {
                return essay(&essay_text);
            }
        }
        return essay(raw);
    }

    // If the text string itself contains an embedded JSON object: e.g. "{\"6\":\"c\"}" or "{\"1\":\"...\"}"
    if let Some(inner_json) = extract_json(text_trimmed)
        && let Ok(Value::Object(ref map)) = serde_json::from_str::<Value>(inner_json)
    {
        if let Some(items) = try_parse_kv_map(map) {
            return pg(items);
        }
        let essay_text = format_essay_map(map);
        if !essay_text.is_empty() {
            return essay(&essay_text);
        }
    }

    let is_explicit_essay = matches!(
        payload
            .kind
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("text" | "essay")
    );

    if !is_explicit_essay && (is_pg || looks_like_pg_string(text_trimmed)) {
        let parts = text_trimmed
            .split(['|', '\n', ';'])
            .map(str::to_owned)
            .collect();
        return pg(parts);
    }

    essay(&text)
}

fn try_parse_kv_map(map: &serde_json::Map<String, Value>) -> Option<Vec<String>> {
    if map.is_empty() {
        return None;
    }
    let mut items = Vec::new();
    for (k, v) in map {
        let clean_key = clean_q(k);
        let choice_str = match v {
            Value::String(s) => clean_choice(s)?,
            Value::Number(n) => n.to_string(),
            _ => return None,
        };
        let num = clean_key
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok();
        items.push((num.unwrap_or(u32::MAX), clean_key, choice_str));
    }
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    Some(
        items
            .into_iter()
            .map(|(_, q, a)| format_choice(&q, &a))
            .collect(),
    )
}

fn format_essay_map(map: &serde_json::Map<String, Value>) -> String {
    if map.is_empty() {
        return String::new();
    }
    // Check if the map has standard single-answer wrapper keys
    for key in ["answer", "jawaban", "text", "content", "response", "result"] {
        if let Some(val) = map.get(key) {
            let extracted = match val {
                Value::String(s) => s.trim().to_owned(),
                Value::Object(inner_map) => format_essay_map(inner_map),
                other => value_text(other),
            };
            if !extracted.is_empty() {
                if let Some(inner) = extract_json(&extracted)
                    && let Ok(Value::Object(ref inner_map)) = serde_json::from_str::<Value>(inner)
                {
                    return format_essay_map(inner_map);
                }
                return extracted;
            }
        }
    }

    let mut entries = Vec::new();
    for (k, v) in map {
        if k == "type" || k == "kind" {
            continue;
        }
        let clean_key = clean_q(k);
        let num = clean_key
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok();
        let text = match v {
            Value::String(s) => s.trim().to_owned(),
            Value::Array(items) => items.iter().map(value_text).collect::<Vec<_>>().join("\n"),
            Value::Object(inner_map) => format_essay_map(inner_map),
            other => value_text(other),
        };
        if !text.is_empty() {
            entries.push((num.unwrap_or(u32::MAX), clean_key, text));
        }
    }

    if entries.is_empty() {
        return String::new();
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    if entries.len() == 1 {
        return entries.remove(0).2;
    }

    entries
        .into_iter()
        .map(|(_, q, ans)| {
            if q.is_empty() {
                ans
            } else {
                format!("{q}. {ans}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn clean_choice(s: &str) -> Option<String> {
    let s = s.trim();
    let trimmed = s
        .trim_matches(|c: char| {
            c == '(' || c == ')' || c == '[' || c == ']' || c == '.' || c == ':'
        })
        .trim();
    if trimmed.len() <= 2 && trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        return Some(trimmed.to_ascii_uppercase());
    }
    if let Some((first, _)) = trimmed.split_once(['.', ')', ':', '-', ' ']) {
        let first = first.trim();
        if first.len() <= 2 && first.chars().all(|c| c.is_ascii_alphabetic()) {
            return Some(first.to_ascii_uppercase());
        }
    }
    if matches!(
        trimmed.to_ascii_lowercase().as_str(),
        "true" | "false" | "benar" | "salah" | "ya" | "tidak"
    ) {
        return Some(trimmed.to_ascii_uppercase());
    }
    None
}

fn clean_q(k: &str) -> String {
    let lower = k.trim().to_ascii_lowercase();
    let stripped = lower
        .strip_prefix("question_")
        .or_else(|| lower.strip_prefix("question"))
        .or_else(|| lower.strip_prefix("soal_"))
        .or_else(|| lower.strip_prefix("soal"))
        .or_else(|| lower.strip_prefix("nomor_"))
        .or_else(|| lower.strip_prefix("no_"))
        .or_else(|| lower.strip_prefix("no."))
        .or_else(|| lower.strip_prefix("no"))
        .or_else(|| lower.strip_prefix("q."))
        .or_else(|| lower.strip_prefix("q_"))
        .or_else(|| lower.strip_prefix("q"))
        .unwrap_or(&lower)
        .trim_matches(|c: char| !c.is_alphanumeric());
    if !stripped.is_empty() {
        stripped.to_owned()
    } else {
        k.trim_matches(|c: char| !c.is_alphanumeric()).to_owned()
    }
}

fn looks_like_pg_items(items: &[String]) -> bool {
    !items.is_empty() && items.iter().all(|s| looks_like_single_pg(s))
}

fn looks_like_pg_string(s: &str) -> bool {
    let parts: Vec<&str> = s
        .split(['|', '\n', ';'])
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    !parts.is_empty() && parts.iter().all(|p| looks_like_single_pg(p))
}

fn looks_like_single_pg(s: &str) -> bool {
    let s = s.trim();
    if s.len() == 1 && s.chars().all(|c| c.is_ascii_alphabetic()) {
        return true;
    }
    if let Some((q, a)) = s.split_once(['.', ':', '-', ')']) {
        let q = q.trim();
        let a = a.trim();
        let q_ok = !q.is_empty() && q.chars().all(|c| c.is_ascii_digit());
        let a_ok = !a.is_empty() && a.len() <= 2 && a.chars().all(|c| c.is_ascii_alphabetic());
        return q_ok && a_ok;
    }
    false
}

fn pg(items: Vec<String>) -> ParsedAnswer {
    let formatted: Vec<String> = items
        .into_iter()
        .map(|item| {
            let item = item.trim().trim_end_matches([',', '.']).trim();
            if let Some((q, a)) = item.split_once(['.', ':', '-', ')']) {
                let q_clean = clean_q(q);
                if !q_clean.is_empty()
                    && q_clean
                        .chars()
                        .all(|c| c.is_ascii_digit() || c.is_ascii_alphabetic())
                {
                    return format_choice(&q_clean, a);
                }
            }
            clean_choice(item).unwrap_or_else(|| item.to_ascii_uppercase())
        })
        .filter(|s| !s.is_empty())
        .collect();
    ParsedAnswer {
        kind: AnswerKind::Pg,
        text: formatted.join(" | "),
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn format_choice(q: &str, a: &str) -> String {
    let q = q.trim().trim_end_matches(['.', ':']);
    let a_clean = clean_choice(a).unwrap_or_else(|| a.trim().to_ascii_uppercase());
    if q.is_empty() {
        a_clean
    } else {
        format!("{q}. {a_clean}")
    }
}

fn extract_json(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    (end > start).then(|| &raw[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(raw: &str) -> (AnswerKind, String) {
        let answer = parse_answer(raw);
        (answer.kind, answer.text)
    }

    #[test]
    fn prompt_describes_the_json_contract() {
        let prompt = system_prompt(CaptureTarget::Screen, UiLanguage::En);
        assert!(prompt.contains("\"type\": \"pg\" | \"essay\""));
        assert!(prompt.contains("3. C | 4. D"));
        assert!(prompt.contains("Never describe"));
    }

    #[test]
    fn schema_requires_type_and_answer() {
        let schema = answer_schema();
        assert_eq!(schema["required"], json!(["type", "answer"]));
        assert_eq!(schema["properties"]["type"]["enum"], json!(["pg", "essay"]));
    }

    #[test]
    fn parses_pg_one_liners() {
        assert_eq!(
            parsed(r#"{"type":"pg","answer":"3. C | 4. D"}"#),
            (AnswerKind::Pg, "3. C | 4. D".into())
        );
        assert_eq!(
            parsed(r#"{"type":"pg","answer":"3. C\n4. D,"}"#),
            (AnswerKind::Pg, "3. C | 4. D".into())
        );
        assert_eq!(
            parsed(r#"{"type":"pg","answer":["1. A","2. B"]}"#),
            (AnswerKind::Pg, "1. A | 2. B".into())
        );
    }

    #[test]
    fn parses_raw_map_of_questions_and_choices() {
        // Exactly what the AI returned in the user's screenshot
        assert_eq!(
            parsed(r#"{"6":"c","7":"c","8":"c"}"#),
            (AnswerKind::Pg, "6. C | 7. C | 8. C".into())
        );
        assert_eq!(
            parsed(r#"{"type":"pg","answer":{"6":"c","7":"c","8":"c"}}"#),
            (AnswerKind::Pg, "6. C | 7. C | 8. C".into())
        );
        assert_eq!(
            parsed(r#"{"type":"pg","answer":"{\"6\":\"c\",\"7\":\"c\",\"8\":\"c\"}"}"#),
            (AnswerKind::Pg, "6. C | 7. C | 8. C".into())
        );
        assert_eq!(
            parsed(r#"{"q1":"a","q2":"b"}"#),
            (AnswerKind::Pg, "1. A | 2. B".into())
        );
    }

    #[test]
    fn parses_essays() {
        assert_eq!(
            parsed(r#"{"type":"essay","answer":"Pancasila adalah dasar negara."}"#),
            (AnswerKind::Essay, "Pancasila adalah dasar negara.".into())
        );
        // Matches user's screenshot where AI replied with {"1": "Pengertian..."}
        assert_eq!(
            parsed(r#"{"1":"Pengertian ranah kognitif, afektif, psikomotor, dan life skill:\n- Kognitif: Ranah yang berkaitan..."}"#),
            (
                AnswerKind::Essay,
                "Pengertian ranah kognitif, afektif, psikomotor, dan life skill:\n- Kognitif: Ranah yang berkaitan...".into()
            )
        );
        assert_eq!(
            parsed(r#"{"type":"essay","answer":{"1":"Pengertian ranah kognitif..."}}"#),
            (AnswerKind::Essay, "Pengertian ranah kognitif...".into())
        );
        assert_eq!(
            parsed(r#"{"1":"Jawaban satu","2":"Jawaban dua"}"#),
            (
                AnswerKind::Essay,
                "1. Jawaban satu\n\n2. Jawaban dua".into()
            )
        );
    }

    #[test]
    fn accepts_the_legacy_shape() {
        let raw = r#"{"kind":"mcq","choices":[{"q":"3","a":"C"},{"q":4,"a":"D"}]}"#;
        assert_eq!(parsed(raw), (AnswerKind::Pg, "3. C | 4. D".into()));
        assert_eq!(
            parsed(r#"{"kind":"text","text":"ok"}"#),
            (AnswerKind::Essay, "ok".into())
        );
    }

    #[test]
    fn pulls_json_out_of_fences_and_falls_back() {
        let fenced = "```json\n{\"type\":\"pg\",\"answer\":\"1. B\"}\n```";
        assert_eq!(parsed(fenced), (AnswerKind::Pg, "1. B".into()));
        assert_eq!(
            parsed("just prose"),
            (AnswerKind::Essay, "just prose".into())
        );
    }

    #[test]
    fn turn_text_is_canonical_json() {
        let answer = ParsedAnswer {
            kind: AnswerKind::Pg,
            text: "3. C".into(),
        };
        let value: Value = serde_json::from_str(&answer.to_turn_text()).unwrap();
        assert_eq!(value, json!({ "type": "pg", "answer": "3. C" }));
        assert!(parse_answer(&answer.to_turn_text()) == answer);
    }

    #[test]
    fn falls_back_to_the_ui_language() {
        assert!(system_prompt(CaptureTarget::Screen, UiLanguage::Id).contains("use Indonesian."));
        assert!(system_prompt(CaptureTarget::Screen, UiLanguage::En).contains("use English."));
    }

    #[test]
    fn mentions_the_capture_target() {
        assert!(
            system_prompt(CaptureTarget::Window, UiLanguage::En).contains("user's active window")
        );
        assert_ne!(
            initial_request(CaptureTarget::Screen),
            initial_request(CaptureTarget::Window)
        );
    }
}
