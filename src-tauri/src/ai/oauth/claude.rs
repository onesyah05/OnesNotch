//! Claude Code subscription login (Anthropic OAuth, authorization code + PKCE).
//!
//! Mirrors the flow Cartethyia uses: a fixed loopback redirect the Claude Code
//! OAuth client registers, PKCE `S256`, and a JSON token exchange that must
//! echo the `state`. At dispatch the access token is a `Bearer` credential with
//! the `oauth-2025-04-20` beta header.

use serde_json::json;

use super::store::OAuthTokens;
use super::{BrowserFlow, LoginMethod, OAuthEndpoints, TokenResponse, post_json};
use crate::ai::oauth::pkce::Pkce;
use crate::error::{AppError, AppResult};

pub(crate) const ENDPOINTS: OAuthEndpoints = OAuthEndpoints {
    client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorize_url: "https://claude.ai/oauth/authorize",
    token_url: "https://api.anthropic.com/v1/oauth/token",
    // Anthropic validates `redirect_uri` against the client's allowlist
    // exactly; the registered host is `localhost` (not `127.0.0.1`).
    redirect_uri: "http://localhost:54545/callback",
    scope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    method: LoginMethod::Browser,
};

/// The beta header the OAuth credential requires at dispatch.
pub(crate) const OAUTH_BETA: &str = "oauth-2025-04-20";

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
            // Anthropic requires this flag to issue an OAuth (not API) code.
            ("code", "true"),
        ],
    )
    .map_err(|_| AppError::Internal("could not build authorize URL".into()))?;
    Ok(BrowserFlow {
        url: url.to_string(),
        verifier: pkce.verifier,
        state,
    })
}

/// Exchanges the authorization `code` (which may carry a `#state` fragment)
/// for tokens.
pub(crate) async fn exchange(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    flow: &BrowserFlow,
    code: &str,
    returned_state: &str,
) -> AppResult<OAuthTokens> {
    let body = json!({
        "grant_type": "authorization_code",
        "client_id": endpoints.client_id,
        "code": code,
        "code_verifier": flow.verifier,
        "redirect_uri": endpoints.redirect_uri,
        // Anthropic rejects a token body that omits `state`.
        "state": returned_state,
    });
    let tokens = post_json(http, endpoints.token_url, &body, &[], "Claude").await?;
    Ok(into_tokens(tokens))
}

/// Refreshes an access token with a refresh token.
pub(crate) async fn refresh(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    refresh_token: &str,
) -> AppResult<OAuthTokens> {
    let body = json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": endpoints.client_id,
    });
    let tokens = post_json(
        http,
        endpoints.token_url,
        &body,
        &[("anthropic-beta", OAUTH_BETA)],
        "Claude",
    )
    .await?;
    Ok(into_tokens(tokens))
}

fn into_tokens(response: TokenResponse) -> OAuthTokens {
    OAuthTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: super::expiry_from(response.expires_in),
        account_label: None,
    }
}
