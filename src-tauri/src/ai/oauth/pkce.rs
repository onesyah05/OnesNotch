//! PKCE (RFC 7636) code verifier / challenge generation.

use rand::RngCore;
use sha2::{Digest, Sha256};

use super::store::base64_url;

/// A generated PKCE pair for one login attempt.
#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    /// Generates a fresh `S256` pair: a 32-byte random verifier and its
    /// BASE64URL(SHA256(verifier)) challenge.
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let verifier = base64_url(&bytes);
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = base64_url(&hasher.finalize());
        Self {
            verifier,
            challenge,
        }
    }
}

/// A random `state` value used as the OAuth correlation key.
pub fn random_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64_url(&bytes)
}

/// A random UUID-shaped id (used for Codex session/thread identity).
#[allow(dead_code)] // used by the dispatch step (wiring in progress)
pub fn random_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_pair_is_deterministic_from_verifier() {
        let pkce = Pkce {
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into(),
            challenge: String::new(),
        };
        let mut hasher = Sha256::new();
        hasher.update(pkce.verifier.as_bytes());
        let challenge = base64_url(&hasher.finalize());
        // RFC 7636 appendix B test vector.
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_pair_differs_each_time() {
        assert_ne!(Pkce::generate().verifier, Pkce::generate().verifier);
    }

    #[test]
    fn uuid_shape() {
        let id = random_uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(id.matches('-').count(), 4);
    }
}
