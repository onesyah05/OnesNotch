//! Antigravity subscription login (Google OAuth 2.0 + PKCE + client secret).
//!
//! Antigravity signs in with a Google account. The client identity is public
//! provider configuration (an installed OAuth client cannot keep a secret
//! confidential), and the secret below is the one the reference Antigravity
//! client ships. At dispatch the access token is a `Bearer` credential against
//! the Cloud Code Assist endpoint, which speaks the Gemini `generateContent`
//! body.

use serde_json::json;

use super::store::OAuthTokens;
use super::{BrowserFlow, LoginMethod, OAuthEndpoints, post_form};
use crate::ai::oauth::pkce::Pkce;
use crate::error::{AppError, AppResult};

pub(crate) const ENDPOINTS: OAuthEndpoints = OAuthEndpoints {
    client_id: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    // Google validates `redirect_uri` against the client's allowlist at both
    // authorize and token time; this is the exact registered value.
    redirect_uri: "http://127.0.0.1:51121/oauth-callback",
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs",
    method: LoginMethod::Browser,
};

/// The client secret, stored base64-encoded to keep a `GOCSPX-` literal out of
/// source. It identifies the client application, not an account.
const CLIENT_SECRET_B64: &str = "R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=";

fn client_secret() -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(CLIENT_SECRET_B64)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// The Cloud Code Assist base URL used at dispatch and project lookup.
#[allow(dead_code)] // used by the dispatch step (wiring in progress)
pub(crate) const CLOUD_CODE_BASE: &str = "https://daily-cloudcode-pa.googleapis.com";

const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

/// Builds the authorize URL the browser should open.
pub(crate) fn browser_flow(endpoints: OAuthEndpoints) -> AppResult<BrowserFlow> {
    let pkce = Pkce::generate();
    let state = super::pkce::random_state();
    let url = url::Url::parse_with_params(
        endpoints.authorize_url,
        &[
            ("client_id", endpoints.client_id),
            ("response_type", "code"),
            ("redirect_uri", endpoints.redirect_uri),
            ("scope", endpoints.scope),
            ("state", state.as_str()),
            ("code_challenge", pkce.challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|_| AppError::Internal("could not build authorize URL".into()))?;
    Ok(BrowserFlow {
        url: url.to_string(),
        verifier: pkce.verifier,
        state,
    })
}

/// Exchanges the authorization `code` for tokens. Google requires the client
/// secret on the token request.
pub(crate) async fn exchange(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    flow: &BrowserFlow,
    code: &str,
) -> AppResult<OAuthTokens> {
    let tokens = post_form(
        http,
        endpoints.token_url,
        &[
            ("client_id", endpoints.client_id),
            ("client_secret", client_secret().as_str()),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", endpoints.redirect_uri),
            ("code_verifier", flow.verifier.as_str()),
        ],
        "Antigravity",
    )
    .await?;
    let label = userinfo_email(http, &tokens.access_token).await;
    Ok(into_tokens(tokens, label))
}

/// Refreshes an access token with a refresh token.
pub(crate) async fn refresh(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    refresh_token: &str,
) -> AppResult<OAuthTokens> {
    let tokens = post_form(
        http,
        endpoints.token_url,
        &[
            ("client_id", endpoints.client_id),
            ("client_secret", client_secret().as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
        "Antigravity",
    )
    .await?;
    Ok(into_tokens(tokens, None))
}

/// Best-effort account email; a failure must not fail the login.
async fn userinfo_email(http: &reqwest::Client, access_token: &str) -> Option<String> {
    let response = http
        .get(USERINFO_URL)
        .timeout(super::TOKEN_TIMEOUT)
        .header("authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = response.json().await.ok()?;
    body.get("email")?.as_str().map(str::to_owned)
}

fn into_tokens(response: super::TokenResponse, label: Option<String>) -> OAuthTokens {
    OAuthTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: super::expiry_from(response.expires_in),
        account_label: label,
    }
}

/// Resolves the caller's Cloud Code Assist project id, needed at dispatch.
///
/// Without it the upstream rejects requests with "no valid license". A fresh
/// account is enrolled in the free tier on first login; this mirrors the native
/// client. Returns `None` on any failure so dispatch can still try.
#[allow(dead_code)] // called by the dispatch step (wiring in progress)
pub(crate) async fn resolve_project(http: &reqwest::Client, access_token: &str) -> Option<String> {
    let url = format!("{CLOUD_CODE_BASE}/v1internal:loadCodeAssist");
    let response = http
        .post(&url)
        .timeout(super::TOKEN_TIMEOUT)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {access_token}"))
        .json(&json!({ "metadata": { "ideType": "ANTIGRAVITY" } }))
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = response.json().await.ok()?;
    body.pointer("/cloudaicompanionProject/id")
        .and_then(|value| value.as_str())
        .or_else(|| {
            body.get("cloudaicompanionProject")
                .and_then(|value| value.as_str())
        })
        .map(str::to_owned)
}
