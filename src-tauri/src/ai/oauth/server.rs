//! A tiny one-shot HTTP server that captures the OAuth redirect on localhost.
//!
//! The provider's authorization server redirects the user's browser to a fixed
//! loopback URI (`http://localhost:54545/callback`, …). That URI names the
//! machine the browser is on, so we bind the port for the life of the login and
//! read the `code` + `state` straight out of the redirect — the only way a
//! redirect can hand us its code without the user copying it by hand.

use std::net::SocketAddr;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::error::{AppError, AppResult};

/// Parses the fixed loopback port and path out of a redirect URI.
///
/// Only `http://` on a loopback host is bindable. A custom scheme is delivered
/// by the OS and a remote host over the network; neither is something this
/// process can bind.
pub(crate) fn parse_loopback(redirect_uri: &str) -> AppResult<(u16, String)> {
    let url = url::Url::parse(redirect_uri)
        .map_err(|_| AppError::Internal("invalid redirect URI".into()))?;
    if url.scheme() != "http" {
        return Err(AppError::Internal("redirect URI is not loopback".into()));
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(AppError::Internal("redirect URI is not loopback".into()));
    }
    let port = url.port().unwrap_or(80);
    let path = if url.path().is_empty() {
        "/".to_owned()
    } else {
        url.path().to_owned()
    };
    Ok((port, path))
}

/// A bound loopback server waiting for exactly one redirect.
pub struct LoopbackServer {
    listener: TcpListener,
    state: String,
    path: String,
}

impl LoopbackServer {
    /// Binds `127.0.0.1:port`. A port that cannot be bound fails the login
    /// immediately rather than advertising an address nothing answers.
    pub async fn bind(port: u16, path: String, state: String) -> AppResult<Self> {
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let listener = TcpListener::bind(addr).await.map_err(|err| {
            AppError::Internal(format!("could not bind login port {port}: {err}"))
        })?;
        Ok(Self {
            listener,
            state,
            path,
        })
    }

    /// Waits for the redirect and returns `(code, state)`.
    ///
    /// `state` is the correlation key: a callback whose state does not match is
    /// rejected, so a replayed or forged redirect cannot complete the flow.
    pub async fn wait(self) -> AppResult<(String, String)> {
        let (mut stream, _) =
            self.listener.accept().await.map_err(|err| {
                AppError::Internal(format!("login callback listener failed: {err}"))
            })?;
        let request = read_request(&mut stream).await?;
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("")
            .to_owned();
        let ok = serve_result(&mut stream, &target, &self.path, &self.state).await;
        let _ = stream.shutdown().await;
        ok
    }
}

/// Reads the request head (we only need the request line).
async fn read_request(stream: &mut TcpStream) -> AppResult<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|err| AppError::Internal(format!("login callback read failed: {err}")))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|w| w == b"\r\n\r\n") || buffer.len() > 16 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

/// Validates the redirect and writes the page the user sees.
async fn serve_result(
    stream: &mut TcpStream,
    target: &str,
    path: &str,
    expected_state: &str,
) -> AppResult<(String, String)> {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params: Vec<(String, String)> = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((k, v)) => (k.to_owned(), urldecode(v)),
            None => (pair.to_owned(), String::new()),
        })
        .collect();
    let get = |key: &str| {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
    };

    let (status, body) = if let Some(error) = get("error") {
        (400, format!("Login failed: {error}"))
    } else if get("state").as_deref() != Some(expected_state) {
        (400, "Login failed: state mismatch.".to_owned())
    } else {
        match get("code") {
            Some(code) if !code.is_empty() => {
                (200, "Signed in. You can close this tab.".to_owned())
            }
            _ => (400, "Login failed: no code returned.".to_owned()),
        }
    };

    // Claude may append the state as a fragment (`code#state`); recover it.
    let code = get("code").unwrap_or_default();
    let state = match get("state") {
        Some(state) if !state.is_empty() => state,
        _ => code
            .split_once('#')
            .map(|(_, s)| s.to_owned())
            .unwrap_or_default(),
    };
    let code = code
        .split_once('#')
        .map(|(c, _)| c.to_owned())
        .unwrap_or(code);

    let response = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n<!doctype html><meta charset=utf-8><title>Notch</title><p>{}</p>",
        if status == 200 { "OK" } else { "Bad Request" },
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|err| AppError::Internal(format!("could not write login response: {err}")))?;

    // Confirm the redirect landed on the path we advertised.
    let path_ok = target.starts_with(path);
    if status == 200 && path_ok && !code.is_empty() {
        Ok((code, state))
    } else if status == 200 {
        Err(AppError::Provider("login redirect path mismatch".into()))
    } else {
        Err(AppError::Provider(
            get("error").unwrap_or_else(|| "login was not completed".into()),
        ))
    }
}

/// Percent-decodes a query value.
fn urldecode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
                out.push(bytes[index]);
                index += 1;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_and_plus() {
        assert_eq!(urldecode("a%20b+c%2Fd"), "a b c/d");
    }

    #[test]
    fn parses_loopback() {
        let (port, path) = super::parse_loopback("http://localhost:54545/callback").unwrap();
        assert_eq!(port, 54545);
        assert_eq!(path, "/callback");
    }
}
