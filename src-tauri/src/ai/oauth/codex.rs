//! Codex subscription login (OpenAI / ChatGPT OAuth, RFC 8628 device flow).
//!
//! Codex signs in with a ChatGPT subscription. It uses a device code rather
//! than a loopback port: the user visits a URL, types a short code, and the
//! flow polls until the provider approves. At dispatch the access token is a
//! `Bearer` credential against the ChatGPT backend's Codex Responses endpoint,
//! with the account id read out of the token's JWT claims.

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::store::OAuthTokens;
use super::{LoginMethod, OAuthEndpoints, post_form, post_json};
use crate::error::{AppError, AppResult};

pub(crate) const ENDPOINTS: OAuthEndpoints = OAuthEndpoints {
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorize_url: "https://auth.openai.com/oauth/authorize",
    token_url: "https://auth.openai.com/oauth/token",
    // Unused by the device flow, but part of the registered client.
    redirect_uri: "https://auth.openai.com/deviceauth/callback",
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    method: LoginMethod::Device,
};

const DEVICE_USERCODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
/// Where the user types the code. The usercode response does not include it.
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
/// The device endpoint states no expiry, so the flow bounds itself.
const DEVICE_TTL: std::time::Duration = std::time::Duration::from_secs(900);
/// The ChatGPT backend that serves Codex Responses.
#[allow(dead_code)] // used by the dispatch step (wiring in progress)
pub(crate) const CHATGPT_BASE: &str = "https://chatgpt.com";

/// What the device flow shows the user before they approve.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceStart {
    pub device_auth_id: String,
    pub verification_url: String,
    pub user_code: String,
    pub interval_seconds: u64,
}

/// Response of the usercode endpoint. Observed shape (2026-11):
/// `{"device_auth_id": "...", "user_code": "...", "interval": "5", "expires_at": "<RFC 3339>"}`
/// — note `interval` is a string, so it goes through the lenient reader.
#[derive(Debug, Deserialize)]
struct UserCodeResponse {
    device_auth_id: String,
    #[serde(alias = "usercode")]
    user_code: String,
    #[serde(
        default,
        alias = "verification_uri_complete",
        alias = "verification_url"
    )]
    verification_uri: Option<String>,
    #[serde(default, deserialize_with = "super::lenient_u64")]
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DevicePollResponse {
    authorization_code: Option<String>,
    code_verifier: Option<String>,
}

/// Starts a device authorization.
pub(crate) async fn start_device(
    http: &reqwest::Client,
    _endpoints: OAuthEndpoints,
) -> AppResult<DeviceStart> {
    let response = http
        .post(DEVICE_USERCODE_URL)
        .timeout(super::TOKEN_TIMEOUT)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&json!({ "client_id": ENDPOINTS.client_id }))
        .send()
        .await
        .map_err(|err| AppError::from(crate::ai::AiError::from(err)))?;
    let status = response.status();
    if !status.is_success() {
        tracing::warn!("Codex device authorization returned HTTP {status}");
        return Err(AppError::Provider(format!(
            "Codex login failed (HTTP {status})"
        )));
    }
    let body: UserCodeResponse = response
        .json()
        .await
        .map_err(|_| AppError::Provider("Codex login returned an invalid response".into()))?;
    Ok(DeviceStart {
        device_auth_id: body.device_auth_id,
        verification_url: body
            .verification_uri
            .unwrap_or_else(|| DEVICE_VERIFICATION_URL.into()),
        user_code: body.user_code,
        interval_seconds: body.interval.unwrap_or(5).max(1),
    })
}

/// Polls until the user approves, then exchanges the code for tokens.
pub(crate) async fn poll_until_done(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    start: &DeviceStart,
) -> AppResult<OAuthTokens> {
    let deadline = tokio::time::Instant::now() + DEVICE_TTL;
    let interval = std::time::Duration::from_secs(start.interval_seconds);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::Timeout);
        }
        tokio::time::sleep(interval).await;

        // One poll attempt. 403/404 mean "not approved yet", not an error.
        let response = http
            .post(DEVICE_TOKEN_URL)
            .timeout(super::TOKEN_TIMEOUT)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .json(&json!({
                "device_auth_id": start.device_auth_id,
                "user_code": start.user_code,
            }))
            .send()
            .await
            .map_err(|err| AppError::from(crate::ai::AiError::from(err)))?;

        let status = response.status().as_u16();
        if status == 403 || status == 404 {
            continue;
        }
        if !response.status().is_success() {
            tracing::warn!("Codex device poll returned HTTP {status}");
            return Err(AppError::Provider(format!(
                "Codex login failed (HTTP {status})"
            )));
        }
        let body: DevicePollResponse = response
            .json()
            .await
            .map_err(|_| AppError::Provider("Codex login returned an invalid response".into()))?;
        match (body.authorization_code, body.code_verifier) {
            (Some(code), Some(verifier)) => {
                let tokens = exchange_device(http, endpoints, &code, &verifier).await?;
                return Ok(tokens);
            }
            _ => continue,
        }
    }
}

/// Exchanges the device authorization code for tokens.
async fn exchange_device(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    code: &str,
    verifier: &str,
) -> AppResult<OAuthTokens> {
    let tokens = post_form(
        http,
        endpoints.token_url,
        &[
            ("client_id", endpoints.client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", endpoints.redirect_uri),
            ("code_verifier", verifier),
        ],
        "Codex",
    )
    .await?;
    Ok(into_tokens(tokens))
}

/// Refreshes an access token with a refresh token.
pub(crate) async fn refresh(
    http: &reqwest::Client,
    endpoints: OAuthEndpoints,
    refresh_token: &str,
) -> AppResult<OAuthTokens> {
    let tokens = post_json(
        http,
        endpoints.token_url,
        &json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": endpoints.client_id,
        }),
        &[],
        "Codex",
    )
    .await?;
    Ok(into_tokens(tokens))
}

fn into_tokens(response: super::TokenResponse) -> OAuthTokens {
    // The ID token carries the signed-in email for "Connected as …".
    let account_label = response
        .id_token
        .as_deref()
        .and_then(jwt_payload)
        .and_then(|claims| claims.get("email")?.as_str().map(str::to_owned));
    OAuthTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: super::expiry_from(response.expires_in),
        account_label,
    }
}

/// Reads the ChatGPT account id out of the access token's JWT claims.
///
/// Returns `None` when the token is not a decodable JWT or carries no claim;
/// dispatch then simply omits the account header.
pub(crate) fn account_id(access_token: &str) -> Option<String> {
    let claims = jwt_payload(access_token)?;
    let value = claims
        .get("chatgpt_account_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    if value.is_some() {
        return value;
    }
    claims
        .pointer("/https://api.openai.com/auth/chatgpt_account_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
}

/// Decodes a JWT's payload segment without verifying the signature (we only
/// read identity claims; the token's validity is the provider's concern).
fn jwt_payload(token: &str) -> Option<serde_json::Value> {
    use base64::Engine as _;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_account_id_from_claims() {
        use base64::Engine as _;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"chatgpt_account_id":"acct-123"}"#);
        let token = format!("{header}.{payload}.sig");
        assert_eq!(account_id(&token).as_deref(), Some("acct-123"));
    }

    #[test]
    fn parses_the_real_usercode_response() {
        // Shape returned by auth.openai.com: `interval` is a string.
        let body = r#"{"device_auth_id":"dev-1","user_code":"ABCD-1234","interval":"5","expires_at":"2026-11-08T04:16:36.558444+00:00"}"#;
        let parsed: UserCodeResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.device_auth_id, "dev-1");
        assert_eq!(parsed.user_code, "ABCD-1234");
        assert_eq!(parsed.interval, Some(5));
        assert_eq!(parsed.verification_uri, None);

        let numeric: UserCodeResponse =
            serde_json::from_str(r#"{"device_auth_id":"d","usercode":"X","interval":7}"#).unwrap();
        assert_eq!(numeric.user_code, "X");
        assert_eq!(numeric.interval, Some(7));
    }

    #[test]
    fn token_response_accepts_string_expiry_and_reads_email() {
        use base64::Engine as _;
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        let id_token = format!(
            "{}.{}.sig",
            enc(r#"{"alg":"none"}"#),
            enc(r#"{"email":"a@b.co"}"#)
        );
        let body = format!(
            r#"{{"access_token":"at","refresh_token":"rt","expires_in":"3600","id_token":"{id_token}"}}"#
        );
        let response: super::super::TokenResponse = serde_json::from_str(&body).unwrap();
        assert_eq!(response.expires_in, Some(3600));
        let tokens = into_tokens(response);
        assert_eq!(tokens.account_label.as_deref(), Some("a@b.co"));
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt"));
    }

    #[test]
    fn missing_claim_is_none() {
        use base64::Engine as _;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"sub":"x"}"#);
        let token = format!("{header}.{payload}.sig");
        assert_eq!(account_id(&token), None);
    }
}
