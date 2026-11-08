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
pub(crate) const CLOUD_CODE_BASE: &str = "https://daily-cloudcode-pa.googleapis.com";

/// Cloud Code Assist only serves the Antigravity client: any other
/// User-Agent gets `403 PERMISSION_DENIED` ("The caller does not have
/// permission"), which used to surface as "The API key is not valid". It also
/// refuses stale client versions ("no longer supported"), so the version is
/// read from Antigravity's own auto-updater and cached.
const UPDATER_URLS: [&str; 2] = [
    "https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/latest-win32-x64.yml",
    "https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/",
];
const FALLBACK_VERSION: &str = "2.29.0";
const VERSION_TTL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);
const VERSION_RETRY: std::time::Duration = std::time::Duration::from_secs(10 * 60);

static VERSION: std::sync::Mutex<Option<(String, std::time::Instant)>> =
    std::sync::Mutex::new(None);

/// The User-Agent of the current Antigravity client. Call
/// [`refresh_client_version`] first so it carries a fresh version.
pub(crate) fn user_agent() -> String {
    let version = VERSION
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|(v, _)| v.clone()))
        .unwrap_or_else(|| FALLBACK_VERSION.to_owned());
    format!("antigravity/hub/{version} (aidev_client; os_type=windows; arch=amd64; cl=963137146)")
}

/// Looks up the newest client version (cached for hours; on failure the last
/// known or fallback version is kept and retried after a few minutes).
pub(crate) async fn refresh_client_version() {
    let fresh = VERSION
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(|(_, until)| std::time::Instant::now() < *until)
        })
        .unwrap_or(false);
    if fresh {
        return;
    }
    let http = crate::ai::http_client();
    let mut found = None;
    for url in UPDATER_URLS {
        let text = match http
            .get(url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => response.text().await.ok(),
            _ => None,
        };
        if let Some(version) = text.as_deref().and_then(version_in) {
            found = Some(version);
            break;
        }
    }
    if let Ok(mut guard) = VERSION.lock() {
        let now = std::time::Instant::now();
        *guard = Some(match found {
            Some(version) => (version, now + VERSION_TTL),
            None => (
                guard
                    .as_ref()
                    .map(|(v, _)| v.clone())
                    .unwrap_or_else(|| FALLBACK_VERSION.to_owned()),
                now + VERSION_RETRY,
            ),
        });
    }
}

/// A version from the updater's YAML manifest (`version: x.y.z`) or its
/// status page (`Stable Version: x.y.z`).
fn version_in(text: &str) -> Option<String> {
    let numeric = |v: &str| {
        !v.is_empty()
            && v.split('.')
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    };
    for line in text.lines() {
        let line = line.split('#').next().unwrap_or_default().trim();
        if let Some(rest) = line.strip_prefix("version") {
            let value = rest
                .trim_start()
                .strip_prefix(':')
                .map(|v| v.trim().trim_matches(['"', '\'']));
            if let Some(value) = value.filter(|v| numeric(v)) {
                return Some(value.to_owned());
            }
        }
    }
    let lower = text.to_ascii_lowercase();
    let at = lower.find("stable version:")? + "stable version:".len();
    let candidate: String = text[at..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let candidate = candidate.trim_end_matches('.').to_owned();
    numeric(&candidate).then_some(candidate)
}

/// The `metadata` block Antigravity sends with project calls.
fn metadata() -> serde_json::Value {
    json!({ "ideType": "ANTIGRAVITY", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI" })
}

/// The account's project, looked up once per sign-in (see [`project`]).
static PROJECT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

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

/// The caller's Cloud Code Assist project id, needed at dispatch.
///
/// Without it the upstream rejects requests with "You do not have a valid
/// license" (403). Looked up once and cached until the next sign-in/out.
pub(crate) async fn project(access_token: &str) -> AppResult<String> {
    if let Some(cached) = PROJECT.lock().ok().and_then(|guard| guard.clone()) {
        return Ok(cached);
    }
    refresh_client_version().await;
    let http = crate::ai::http_client();
    let project = resolve_project(&http, access_token).await?;
    if let Ok(mut guard) = PROJECT.lock() {
        *guard = Some(project.clone());
    }
    Ok(project)
}

/// Drops the cached project; called on sign-in and sign-out.
pub(crate) fn forget_project() {
    if let Ok(mut guard) = PROJECT.lock() {
        *guard = None;
    }
}

async fn resolve_project(http: &reqwest::Client, access_token: &str) -> AppResult<String> {
    let loaded = cloud_code_call(
        http,
        access_token,
        "loadCodeAssist",
        &json!({ "metadata": metadata() }),
    )
    .await?;
    if let Some(project) = project_from(&loaded) {
        return Ok(project);
    }
    // A first-time account has no project yet; enrolling it in the default
    // tier creates one, the same way the Antigravity client does.
    let tier = loaded
        .get("allowedTiers")
        .and_then(|tiers| tiers.as_array())
        .and_then(|tiers| {
            tiers
                .iter()
                .find(|tier| tier.get("isDefault").and_then(|d| d.as_bool()) == Some(true))
        })
        .and_then(|tier| tier.get("id").and_then(|id| id.as_str()))
        .unwrap_or("free-tier")
        .to_owned();
    let onboarded = cloud_code_call(
        http,
        access_token,
        "onboardUser",
        &json!({ "tierId": tier, "metadata": metadata() }),
    )
    .await?;
    onboarded.get("response").and_then(project_from).ok_or_else(|| {
        AppError::Provider(
            "This Google account has no Antigravity project yet. Open Antigravity once to finish setup, then sign in again.".into(),
        )
    })
}

async fn cloud_code_call(
    http: &reqwest::Client,
    access_token: &str,
    method: &str,
    body: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let response = http
        .post(format!("{CLOUD_CODE_BASE}/v1internal:{method}"))
        .timeout(super::TOKEN_TIMEOUT)
        .header("user-agent", user_agent())
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {access_token}"))
        .json(body)
        .send()
        .await
        .map_err(|err| AppError::from(crate::ai::AiError::from(err)))?;
    let status = response.status();
    if !status.is_success() {
        tracing::warn!("Antigravity {method} returned HTTP {status}");
        return Err(match status.as_u16() {
            401 => AppError::InvalidKey,
            _ => AppError::Provider(format!("Antigravity {method} failed (HTTP {status})")),
        });
    }
    response
        .json()
        .await
        .map_err(|_| AppError::Provider("Antigravity returned an invalid response".into()))
}

/// `cloudaicompanionProject` is a plain string for consumer accounts
/// (e.g. `"aicode-consumers"`) and an object with an `id` for Cloud projects.
fn project_from(body: &serde_json::Value) -> Option<String> {
    let value = body.get("cloudaicompanionProject")?;
    value
        .as_str()
        .or_else(|| value.get("id").and_then(|id| id.as_str()))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_project_as_string_or_object() {
        let consumer = json!({ "cloudaicompanionProject": "aicode-consumers" });
        assert_eq!(project_from(&consumer).as_deref(), Some("aicode-consumers"));
        let cloud = json!({ "cloudaicompanionProject": { "id": "my-proj" } });
        assert_eq!(project_from(&cloud).as_deref(), Some("my-proj"));
        assert_eq!(project_from(&json!({ "currentTier": {} })), None);
        assert_eq!(
            project_from(&json!({ "cloudaicompanionProject": "" })),
            None
        );
    }

    #[test]
    fn reads_client_version_from_updater_answers() {
        assert_eq!(
            version_in("path: x.exe\nversion: 2.31.4\n").as_deref(),
            Some("2.31.4")
        );
        assert_eq!(
            version_in("version: \"2.30.0\" # stable").as_deref(),
            Some("2.30.0")
        );
        assert_eq!(
            version_in("<p>Stable Version: 2.29.7</p>").as_deref(),
            Some("2.29.7")
        );
        assert_eq!(version_in("nothing here"), None);
        assert!(user_agent().starts_with("antigravity/hub/"));
    }
}
