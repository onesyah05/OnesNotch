//! Subscription login for hosted providers ("login with your subscription").
//!
//! Mirrors the OAuth flows Cartethyia uses for Claude Code, Codex and
//! Antigravity, so a user signs in with the account they already pay for
//! instead of pasting an API key. Every flow runs in Rust: the webview only
//! ever sees `logged_in` / `account_label`, never a token (AGENTS.md rule 5).
//!
//! Three shapes are covered:
//! - **Claude** — authorization-code + PKCE against a fixed loopback port.
//! - **Codex** — RFC 8628 device flow (no port, the user types a code).
//! - **Antigravity** — Google authorization-code + PKCE + client secret.
//!
//! Tokens are stored in Windows Credential Manager and refreshed lazily before
//! a request. Dispatch reuses the existing [`Provider`](super::Provider)
//! implementations by swapping the credential for the fresh access token and
//! adding the OAuth-specific headers each upstream expects.

pub(crate) mod antigravity;
pub(crate) mod claude;
pub(crate) mod codex;
mod pkce;
mod server;
mod store;

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub use store::{OAuthTokens, delete_tokens, has_tokens, load_tokens, save_tokens};

/// How long a token exchange or refresh may take.
pub(crate) const TOKEN_TIMEOUT: Duration = Duration::from_secs(30);
/// Refresh when the access token is within this window of expiring.
const EXPIRY_MARGIN: Duration = Duration::from_secs(120);

/// Which login method a provider's subscription login uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginMethod {
    /// Authorization-code + PKCE on a local loopback port.
    Browser,
    /// RFC 8628 device code: the user visits a URL and types a code.
    Device,
}

/// The user-facing progress of a login, streamed to the settings window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LoginEvent {
    /// Codex only: show this URL and code, then wait for approval.
    DeviceCode {
        verification_url: String,
        user_code: String,
    },
    /// A browser flow opened the system browser.
    BrowserOpened,
    /// The account is signed in.
    LoggedIn { account_label: Option<String> },
}

/// A provider's fixed OAuth endpoints and identity.
#[derive(Debug, Clone, Copy)]
pub(crate) struct OAuthEndpoints {
    pub client_id: &'static str,
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub redirect_uri: &'static str,
    pub scope: &'static str,
    pub method: LoginMethod,
}

impl OAuthEndpoints {
    /// Parses the fixed loopback port and path out of `redirect_uri`.
    pub(crate) fn loopback(&self) -> AppResult<(u16, String)> {
        server::parse_loopback(self.redirect_uri)
    }
}

/// Decides whether a provider uses subscription login, and its endpoints.
pub(crate) fn endpoints(id: crate::ai::ProviderId) -> Option<OAuthEndpoints> {
    match id {
        crate::ai::ProviderId::Anthropic => Some(claude::ENDPOINTS),
        crate::ai::ProviderId::Codex => Some(codex::ENDPOINTS),
        crate::ai::ProviderId::Antigravity => Some(antigravity::ENDPOINTS),
        _ => None,
    }
}

/// The pieces a browser flow needs: the URL to open plus the PKCE verifier and
/// `state` the exchange needs. The whole login runs inside one call, so these
/// are carried in this struct rather than a shared map.
pub(crate) struct BrowserFlow {
    pub url: String,
    pub verifier: String,
    pub state: String,
}

/// Runs a full login for `id`, emitting progress through `on_event`.
///
/// Browser flows open the system browser and block on a loopback server until
/// the provider redirects back. Device flows return a code to show and poll
/// until the user approves. Both end by persisting tokens and returning the
/// account label.
pub(crate) async fn login<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    id: crate::ai::ProviderId,
    mut on_event: impl FnMut(LoginEvent) + Send + 'static,
) -> AppResult<Option<String>> {
    let endpoints = endpoints(id).ok_or_else(|| {
        AppError::InvalidInput("this provider does not support subscription login".into())
    })?;
    let http = super::http_client();

    let tokens = match endpoints.method {
        LoginMethod::Browser => {
            let (port, path) = endpoints.loopback()?;
            let flow = match id {
                crate::ai::ProviderId::Antigravity => antigravity::browser_flow(endpoints)?,
                _ => claude::browser_flow(endpoints)?,
            };
            let listener = server::LoopbackServer::bind(port, path, flow.state.clone()).await?;
            open::that_detached(&flow.url)
                .map_err(|err| AppError::Internal(format!("could not open browser: {err}")))?;
            on_event(LoginEvent::BrowserOpened);
            let (code, state) = listener.wait().await?;
            match id {
                crate::ai::ProviderId::Antigravity => {
                    antigravity::exchange(&http, endpoints, &flow, &code).await?
                }
                _ => claude::exchange(&http, endpoints, &flow, &code, &state).await?,
            }
        }
        LoginMethod::Device => {
            let start = codex::start_device(&http, endpoints).await?;
            on_event(LoginEvent::DeviceCode {
                verification_url: start.verification_url.clone(),
                user_code: start.user_code.clone(),
            });
            codex::poll_until_done(&http, endpoints, &start).await?
        }
    };

    save_tokens(id, &tokens)?;
    on_event(LoginEvent::LoggedIn {
        account_label: tokens.account_label.clone(),
    });
    Ok(tokens.account_label)
}

/// Returns a valid access token for `id`, refreshing it if it is stale.
///
/// This is the only path that hands out a token, and it is called from Rust
/// right before a request, so the token never reaches the webview.
pub(crate) async fn access_token<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    id: crate::ai::ProviderId,
) -> AppResult<String> {
    let endpoints = endpoints(id).ok_or(AppError::NoKey)?;
    let tokens = load_tokens(id)?.ok_or(AppError::NoKey)?;

    if !tokens.needs_refresh(EXPIRY_MARGIN) {
        return Ok(tokens.access_token);
    }
    let Some(refresh_token) = tokens.refresh_token.clone() else {
        // No refresh token: the stored access token is all we have.
        return Ok(tokens.access_token);
    };

    let http = super::http_client();
    let refreshed = match id {
        crate::ai::ProviderId::Anthropic => {
            claude::refresh(&http, endpoints, &refresh_token).await?
        }
        crate::ai::ProviderId::Codex => codex::refresh(&http, endpoints, &refresh_token).await?,
        crate::ai::ProviderId::Antigravity => {
            antigravity::refresh(&http, endpoints, &refresh_token).await?
        }
        _ => return Err(AppError::NoKey),
    };
    // Providers may rotate the refresh token; keep the old one when they do not.
    let merged = OAuthTokens {
        access_token: refreshed.access_token,
        refresh_token: refreshed
            .refresh_token
            .clone()
            .or_else(|| tokens.refresh_token.clone()),
        expires_at: refreshed.expires_at,
        account_label: refreshed
            .account_label
            .or_else(|| tokens.account_label.clone()),
    };
    save_tokens(id, &merged)?;
    Ok(merged.access_token)
}

/// Converts `expires_in` seconds into an absolute Unix expiry, defaulting to a
/// conservative 45 minutes when the provider omits it.
pub(crate) fn expiry_from(expires_in: Option<u64>) -> u64 {
    let seconds = expires_in.unwrap_or(45 * 60);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now + seconds
}

/// The shared token response body across providers.
#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}

/// Reads a token response, mapping transport/HTTP failures to `AppError`.
pub(crate) async fn read_token_response(
    response: reqwest::Response,
    provider: &str,
) -> AppResult<TokenResponse> {
    let status = response.status();
    if !status.is_success() {
        // Only the status is logged; the body can echo request content (rule 9).
        tracing::warn!("{provider} token endpoint returned HTTP {status}");
        return Err(AppError::Provider(format!(
            "{provider} login failed (HTTP {status})"
        )));
    }
    response
        .json::<TokenResponse>()
        .await
        .map_err(|_| AppError::Provider(format!("{provider} login returned an invalid response")))
}

/// Posts a form-encoded token request and parses the response.
pub(crate) async fn post_form(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
    provider: &str,
) -> AppResult<TokenResponse> {
    let response = http
        .post(url)
        .timeout(TOKEN_TIMEOUT)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|err| AppError::from(super::AiError::from(err)))?;
    read_token_response(response, provider).await
}

/// Posts a JSON token request and parses the response.
pub(crate) async fn post_json<T: Serialize + ?Sized>(
    http: &reqwest::Client,
    url: &str,
    body: &T,
    headers: &[(&str, &str)],
    provider: &str,
) -> AppResult<TokenResponse> {
    let mut request = http
        .post(url)
        .timeout(TOKEN_TIMEOUT)
        .header("content-type", "application/json")
        .header("accept", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = request
        .json(body)
        .send()
        .await
        .map_err(|err| AppError::from(super::AiError::from(err)))?;
    read_token_response(response, provider).await
}
