use crate::commands::fs::validate_transfer_id;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{App, AppHandle, Manager, State};

const SESSION_FILE: &str = "transfer-sessions-v1.json";
const MAX_TRANSFER_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_METADATA_LENGTH: usize = 1024;

#[derive(Clone)]
pub struct TransferSessionRegistry {
    path: PathBuf,
    sessions: Arc<Mutex<HashMap<String, DurableTransferSession>>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableTransferSession {
    pub transfer_id: String,
    pub message_id: String,
    pub direction: String,
    pub status: String,
    pub expected_size: u64,
    pub transferred_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_fingerprint: Option<String>,
    pub updated_at: u64,
}

pub fn start(app: &App) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(SESSION_FILE);
    let mut sessions = load_sessions(&path)?;
    let mut changed = false;
    for session in sessions.values_mut() {
        if matches!(session.status.as_str(), "sending" | "receiving" | "queued") {
            session.status = "interrupted".to_string();
            session.updated_at = now_millis();
            changed = true;
        }
    }
    let registry = TransferSessionRegistry {
        path,
        sessions: Arc::new(Mutex::new(sessions)),
    };
    if changed {
        registry.flush()?;
    }
    app.manage(registry);
    Ok(())
}

#[tauri::command]
pub async fn save_transfer_session(
    registry: State<'_, TransferSessionRegistry>,
    session: DurableTransferSession,
) -> Result<(), String> {
    registry.save(session)
}

#[tauri::command]
pub async fn list_recoverable_transfer_sessions(
    registry: State<'_, TransferSessionRegistry>,
) -> Result<Vec<DurableTransferSession>, String> {
    registry.list()
}

#[tauri::command]
pub async fn remove_transfer_session(
    registry: State<'_, TransferSessionRegistry>,
    transfer_id: String,
) -> Result<(), String> {
    registry.remove(&transfer_id)
}

pub fn record(app: &AppHandle, session: DurableTransferSession) -> Result<(), String> {
    let registry = app
        .try_state::<TransferSessionRegistry>()
        .ok_or_else(|| "transfer session registry is unavailable".to_string())?;
    registry.save(session)
}

pub fn update_progress(
    app: &AppHandle,
    transfer_id: &str,
    transferred_bytes: u64,
    status: &str,
) -> Result<(), String> {
    let registry = app
        .try_state::<TransferSessionRegistry>()
        .ok_or_else(|| "transfer session registry is unavailable".to_string())?;
    registry.update_progress(transfer_id, transferred_bytes, status)
}

pub fn update_status(app: &AppHandle, transfer_id: &str, status: &str) -> Result<(), String> {
    let registry = app
        .try_state::<TransferSessionRegistry>()
        .ok_or_else(|| "transfer session registry is unavailable".to_string())?;
    registry.update_status(transfer_id, status)
}

pub fn remove(app: &AppHandle, transfer_id: &str) -> Result<(), String> {
    let registry = app
        .try_state::<TransferSessionRegistry>()
        .ok_or_else(|| "transfer session registry is unavailable".to_string())?;
    registry.remove(transfer_id)
}

impl TransferSessionRegistry {
    fn save(&self, mut session: DurableTransferSession) -> Result<(), String> {
        validate_session(&session)?;
        session.updated_at = now_millis();
        self.with_sessions(|sessions| {
            sessions.insert(session.transfer_id.clone(), session);
        })
    }

    fn list(&self) -> Result<Vec<DurableTransferSession>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "transfer session lock poisoned".to_string())?;
        let mut values = sessions.values().cloned().collect::<Vec<_>>();
        values.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(values)
    }

    fn update_progress(
        &self,
        transfer_id: &str,
        transferred_bytes: u64,
        status: &str,
    ) -> Result<(), String> {
        validate_transfer_id(transfer_id)?;
        validate_status(status)?;
        self.with_sessions(|sessions| {
            if let Some(session) = sessions.get_mut(transfer_id) {
                session.transferred_bytes = transferred_bytes.min(session.expected_size);
                session.status = status.to_string();
                session.updated_at = now_millis();
            }
        })
    }

    fn update_status(&self, transfer_id: &str, status: &str) -> Result<(), String> {
        validate_transfer_id(transfer_id)?;
        validate_status(status)?;
        self.with_sessions(|sessions| {
            if let Some(session) = sessions.get_mut(transfer_id) {
                session.status = status.to_string();
                session.updated_at = now_millis();
            }
        })
    }

    fn remove(&self, transfer_id: &str) -> Result<(), String> {
        validate_transfer_id(transfer_id)?;
        self.with_sessions(|sessions| {
            sessions.remove(transfer_id);
        })
    }

    fn with_sessions(
        &self,
        update: impl FnOnce(&mut HashMap<String, DurableTransferSession>),
    ) -> Result<(), String> {
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "transfer session lock poisoned".to_string())?;
            update(&mut sessions);
        }
        self.flush()
    }

    fn flush(&self) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "transfer session lock poisoned".to_string())?;
        let mut values = sessions.values().cloned().collect::<Vec<_>>();
        values.sort_by(|left, right| left.transfer_id.cmp(&right.transfer_id));
        let bytes = serde_json::to_vec(&values).map_err(|error| error.to_string())?;
        let directory = self
            .path
            .parent()
            .ok_or_else(|| "transfer session directory is unavailable".to_string())?;
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let backup = self.path.with_extension("bak");
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&backup);
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        if self.path.exists() {
            fs::rename(&self.path, &backup).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, &self.path).map_err(|error| error.to_string())?;
        let _ = fs::remove_file(&backup);
        Ok(())
    }
}

fn load_sessions(path: &PathBuf) -> Result<HashMap<String, DurableTransferSession>, String> {
    let backup = path.with_extension("bak");
    if !path.exists() && backup.exists() {
        fs::rename(&backup, path).map_err(|error| error.to_string())?;
    }
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let parsed = match serde_json::from_slice::<Vec<DurableTransferSession>>(&bytes) {
        Ok(parsed) => parsed,
        Err(_) => {
            let backup = path.with_extension(format!("corrupt-{}", now_millis()));
            fs::rename(path, backup).map_err(|error| error.to_string())?;
            return Ok(HashMap::new());
        }
    };
    let mut sessions = HashMap::new();
    for session in parsed {
        if validate_session(&session).is_err() {
            let backup = path.with_extension(format!("corrupt-{}", now_millis()));
            fs::rename(path, backup).map_err(|error| error.to_string())?;
            return Ok(HashMap::new());
        }
        sessions.insert(session.transfer_id.clone(), session);
    }
    Ok(sessions)
}

fn validate_session(session: &DurableTransferSession) -> Result<(), String> {
    validate_transfer_id(&session.transfer_id)?;
    if session.message_id.is_empty() || session.message_id.len() > 128 {
        return Err("invalid transfer session message id".to_string());
    }
    if !matches!(session.direction.as_str(), "incoming" | "outgoing") {
        return Err("invalid transfer session direction".to_string());
    }
    validate_status(&session.status)?;
    if session.expected_size > MAX_TRANSFER_BYTES
        || session.transferred_bytes > session.expected_size
    {
        return Err("invalid transfer session size".to_string());
    }
    for value in [
        session.source_path.as_deref(),
        session.save_folder.as_deref(),
        session.sha256.as_deref(),
        session.peer_fingerprint.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.is_empty() || value.len() > MAX_METADATA_LENGTH || value.contains('\0') {
            return Err("invalid transfer session metadata".to_string());
        }
    }
    Ok(())
}

fn validate_status(status: &str) -> Result<(), String> {
    if matches!(
        status,
        "queued" | "sending" | "receiving" | "paused" | "interrupted" | "failed"
    ) {
        Ok(())
    } else {
        Err("invalid transfer session status".to_string())
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        load_sessions, now_millis, validate_session, DurableTransferSession,
        TransferSessionRegistry,
    };
    use std::{
        collections::HashMap,
        fs,
        sync::{Arc, Mutex},
    };

    fn session() -> DurableTransferSession {
        DurableTransferSession {
            transfer_id: "tr_01".to_string(),
            message_id: "msg_01".to_string(),
            direction: "incoming".to_string(),
            status: "interrupted".to_string(),
            expected_size: 100,
            transferred_bytes: 50,
            source_path: None,
            save_folder: Some("~/Downloads/KunoChat".to_string()),
            sha256: None,
            peer_fingerprint: Some("abab:abab".to_string()),
            updated_at: 1,
        }
    }

    #[test]
    fn accepts_a_recoverable_session() {
        assert!(validate_session(&session()).is_ok());
    }

    #[test]
    fn rejects_out_of_range_recovery_bytes() {
        let mut value = session();
        value.transferred_bytes = 101;
        assert!(validate_session(&value).is_err());
    }

    #[test]
    fn persists_and_restores_transfer_progress() {
        let directory = std::env::temp_dir().join(format!(
            "kunochat-session-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let path = directory.join("sessions.json");
        let registry = TransferSessionRegistry {
            path: path.clone(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        };
        registry.save(session()).expect("save");
        registry
            .update_progress("tr_01", 75, "receiving")
            .expect("progress");
        let restored = load_sessions(&path).expect("load");
        assert_eq!(restored["tr_01"].transferred_bytes, 75);
        assert_eq!(restored["tr_01"].status, "receiving");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn quarantines_a_corrupted_session_file() {
        let directory = std::env::temp_dir().join(format!(
            "kunochat-session-corrupt-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(&directory).expect("directory");
        let path = directory.join("sessions.json");
        fs::write(&path, b"not json").expect("write");
        assert!(load_sessions(&path).expect("recovery").is_empty());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn quarantines_valid_json_with_invalid_session_data() {
        let directory = std::env::temp_dir().join(format!(
            "kunochat-session-invalid-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(&directory).expect("directory");
        let path = directory.join("sessions.json");
        fs::write(
            &path,
            br#"[{"transferId":"../invalid","messageId":"msg","direction":"incoming","status":"receiving","expectedSize":1,"transferredBytes":0,"updatedAt":1}]"#,
        )
        .expect("write");
        assert!(load_sessions(&path).expect("recovery").is_empty());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(directory);
    }
}
