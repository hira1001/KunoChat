use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use keyring::{Entry, Error as KeyringError};
use rand_core::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};

const KEYRING_SERVICE: &str = "com.kunochat.app";
const KEYRING_ACCOUNT: &str = "device-identity-v1";
const MAX_CHALLENGE_BYTES: usize = 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub public_key: String,
    pub fingerprint: String,
}

#[tauri::command]
pub async fn get_device_identity() -> Result<DeviceIdentity, String> {
    let signing_key = load_or_create_signing_key()?;
    Ok(identity_from_signing_key(&signing_key))
}

#[tauri::command]
pub async fn sign_device_challenge(challenge: String) -> Result<String, String> {
    validate_challenge(&challenge)?;
    let signing_key = load_or_create_signing_key()?;
    Ok(hex_encode(
        &signing_key.sign(challenge.as_bytes()).to_bytes(),
    ))
}

#[tauri::command]
pub async fn verify_device_signature(
    public_key: String,
    challenge: String,
    signature: String,
) -> Result<bool, String> {
    validate_challenge(&challenge)?;
    let public_key = decode_fixed_hex::<32>(&public_key, "public key")?;
    let signature = decode_fixed_hex::<64>(&signature, "signature")?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "invalid device public key".to_string())?;
    let signature = Signature::from_bytes(&signature);
    Ok(verifying_key
        .verify(challenge.as_bytes(), &signature)
        .is_ok())
}

fn load_or_create_signing_key() -> Result<SigningKey, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())?;
    match entry.get_secret() {
        Ok(seed) => signing_key_from_seed(&seed),
        Err(KeyringError::NoEntry) => {
            let signing_key = SigningKey::generate(&mut OsRng);
            entry.set_secret(&signing_key.to_bytes()).map_err(|error| {
                format!("failed to store device key in secure storage: {error}")
            })?;
            Ok(signing_key)
        }
        Err(error) => Err(format!("failed to access secure device storage: {error}")),
    }
}

fn signing_key_from_seed(seed: &[u8]) -> Result<SigningKey, String> {
    let seed: [u8; 32] = seed
        .try_into()
        .map_err(|_| "stored device key has an invalid length".to_string())?;
    Ok(SigningKey::from_bytes(&seed))
}

fn identity_from_signing_key(signing_key: &SigningKey) -> DeviceIdentity {
    let public_key = signing_key.verifying_key().to_bytes();
    let digest = Sha256::digest(public_key);
    DeviceIdentity {
        public_key: hex_encode(&public_key),
        fingerprint: format_fingerprint(&digest),
    }
}

fn validate_challenge(challenge: &str) -> Result<(), String> {
    if challenge.is_empty() || challenge.len() > MAX_CHALLENGE_BYTES || challenge.contains('\0') {
        return Err("invalid identity challenge".to_string());
    }
    Ok(())
}

fn decode_fixed_hex<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    if value.len() != N * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("invalid device {label}"));
    }
    let mut bytes = [0_u8; N];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| format!("invalid device {label}"))?;
    }
    Ok(bytes)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn format_fingerprint(digest: &[u8]) -> String {
    digest[..16]
        .chunks(2)
        .map(hex_encode)
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::{decode_fixed_hex, format_fingerprint, signing_key_from_seed, validate_challenge};
    use ed25519_dalek::{Signer, Verifier};

    #[test]
    fn rejects_invalid_identity_input() {
        assert!(validate_challenge("").is_err());
        assert!(validate_challenge(&"x".repeat(1025)).is_err());
        assert!(decode_fixed_hex::<32>("zz", "public key").is_err());
    }

    #[test]
    fn signs_and_verifies_with_the_stored_seed_shape() {
        let signing_key = signing_key_from_seed(&[7_u8; 32]).expect("key");
        let signature = signing_key.sign(b"KunoChat/auth/v1");
        signing_key
            .verifying_key()
            .verify(b"KunoChat/auth/v1", &signature)
            .expect("signature");
    }

    #[test]
    fn formats_a_stable_short_fingerprint() {
        assert_eq!(
            format_fingerprint(&[0xab; 32]),
            "abab:abab:abab:abab:abab:abab:abab:abab"
        );
    }
}
