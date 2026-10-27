//! Incremental decoder for streamed responses: Server-Sent Events (Anthropic,
//! OpenAI, Gemini) and newline-delimited JSON (Ollama).
//!
//! Network chunks can split anywhere, including inside a UTF-8 sequence, so
//! bytes are buffered until a full line is available.

#![allow(dead_code)]

/// How a provider frames its stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    Sse,
    NdJson,
}

/// One logical message from the stream.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Record {
    /// SSE `event:` field; always `None` for NDJSON.
    pub event: Option<String>,
    /// SSE `data:` lines joined with `\n`, or one NDJSON line.
    pub data: String,
}

pub struct Decoder {
    framing: Framing,
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl Decoder {
    pub fn new(framing: Framing) -> Self {
        Self {
            framing,
            buffer: Vec::new(),
            event: None,
            data: Vec::new(),
        }
    }

    /// Feeds raw bytes and returns every record completed by them.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Record> {
        self.buffer.extend_from_slice(bytes);
        let mut records = Vec::new();
        while let Some(end) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]);
            let line = line.strip_suffix('\r').unwrap_or(&line);
            self.line(line, &mut records);
        }
        records
    }

    /// Flushes whatever is left once the stream has ended.
    pub fn finish(&mut self) -> Vec<Record> {
        let mut records = Vec::new();
        if !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            let rest = String::from_utf8_lossy(&rest);
            self.line(rest.trim_end_matches('\r'), &mut records);
        }
        if self.framing == Framing::Sse {
            self.dispatch(&mut records);
        }
        records
    }

    fn line(&mut self, line: &str, records: &mut Vec<Record>) {
        match self.framing {
            Framing::NdJson => {
                let line = line.trim();
                if !line.is_empty() {
                    records.push(Record {
                        event: None,
                        data: line.to_owned(),
                    });
                }
            }
            Framing::Sse => {
                if line.is_empty() {
                    self.dispatch(records);
                    return;
                }
                if line.starts_with(':') {
                    // Comment / keep-alive (e.g. OpenRouter's ": PROCESSING").
                    return;
                }
                let (field, value) = match line.split_once(':') {
                    Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
                    None => (line, ""),
                };
                match field {
                    "data" => self.data.push(value.to_owned()),
                    "event" => self.event = Some(value.to_owned()),
                    // `id` and `retry` are irrelevant for one-shot requests.
                    _ => {}
                }
            }
        }
    }

    fn dispatch(&mut self, records: &mut Vec<Record>) {
        if self.data.is_empty() {
            self.event = None;
            return;
        }
        records.push(Record {
            event: self.event.take(),
            data: std::mem::take(&mut self.data).join("\n"),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(records: &[Record]) -> Vec<&str> {
        records.iter().map(|r| r.data.as_str()).collect()
    }

    #[test]
    fn parses_events_with_names() {
        let mut decoder = Decoder::new(Framing::Sse);
        let records = decoder.push(b"event: ping\ndata: {}\n\nevent: delta\ndata: {\"a\":1}\n\n");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].event.as_deref(), Some("ping"));
        assert_eq!(records[1].event.as_deref(), Some("delta"));
        assert_eq!(records[1].data, "{\"a\":1}");
    }

    #[test]
    fn handles_chunks_split_anywhere() {
        let stream = "data: {\"text\":\"halo dunia ✓\"}\r\n\r\ndata: [DONE]\r\n\r\n".as_bytes();
        for split in 1..stream.len() {
            let mut decoder = Decoder::new(Framing::Sse);
            let mut records = decoder.push(&stream[..split]);
            records.extend(decoder.push(&stream[split..]));
            records.extend(decoder.finish());
            assert_eq!(
                data(&records),
                vec!["{\"text\":\"halo dunia ✓\"}", "[DONE]"],
                "split at {split}"
            );
        }
    }

    #[test]
    fn joins_multi_line_data_and_skips_comments() {
        let mut decoder = Decoder::new(Framing::Sse);
        let records = decoder.push(b": keep-alive\ndata: line one\ndata:line two\nid: 7\n\n");
        assert_eq!(data(&records), vec!["line one\nline two"]);
    }

    #[test]
    fn flushes_an_unterminated_event_on_finish() {
        let mut decoder = Decoder::new(Framing::Sse);
        assert!(decoder.push(b"data: tail").is_empty());
        assert_eq!(data(&decoder.finish()), vec!["tail"]);
    }

    #[test]
    fn parses_ndjson_lines() {
        let mut decoder = Decoder::new(Framing::NdJson);
        let mut records = decoder.push(b"{\"a\":1}\n\n{\"b\"");
        records.extend(decoder.push(b":2}\n{\"c\":3}"));
        records.extend(decoder.finish());
        assert_eq!(data(&records), vec!["{\"a\":1}", "{\"b\":2}", "{\"c\":3}"]);
        assert!(records.iter().all(|r| r.event.is_none()));
    }
}
