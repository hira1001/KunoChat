use crate::commands::{
    fs::{prepare_part_path, validate_transfer_id},
    transfer_session::{self, DurableTransferSession},
};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{async_runtime, App, AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Semaphore,
    time::{timeout, Duration},
};

pub const NATIVE_TRANSFER_PORT: u16 = 8790;
const MAGIC: &[u8; 6] = b"KUNO01";
const CHUNK_SIZE: usize = 60 * 1024;
const MAX_FRAME_BYTES: usize = CHUNK_SIZE + 16;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(6);
const FRAME_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_TRANSFER_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const RECEIVE_TICKET_TTL: Duration = Duration::from_secs(60);
const MAX_INCOMING_CONNECTIONS: usize = 16;
const SESSION_PERSIST_INTERVAL: u64 = 1024 * 1024;
const ACCEPT: u8 = 0xa1;
static NEXT_CONNECTION_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct NativeTransferService {
    pending_receives: Arc<Mutex<HashMap<String, ReceiveTicket>>>,
    cancelled_sends: Arc<Mutex<HashSet<String>>>,
    paused_sends: Arc<Mutex<HashSet<String>>>,
    incoming_connections: Arc<Semaphore>,
}

#[derive(Clone)]
struct ReceiveTicket {
    message_id: String,
    expected_size: u64,
    key: [u8; 32],
    part_path: PathBuf,
    prepared_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReceivePreparation {
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTransferEvent {
    message_id: String,
    transfer_id: String,
    direction: String,
    phase: String,
    transferred_bytes: u64,
    total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

pub fn start(app: &App) {
    let service = NativeTransferService {
        pending_receives: Arc::new(Mutex::new(HashMap::new())),
        cancelled_sends: Arc::new(Mutex::new(HashSet::new())),
        paused_sends: Arc::new(Mutex::new(HashSet::new())),
        incoming_connections: Arc::new(Semaphore::new(MAX_INCOMING_CONNECTIONS)),
    };
    app.manage(service.clone());
    let handle = app.handle().clone();
    async_runtime::spawn(async move {
        if let Err(error) = run_listener(handle, service).await {
            eprintln!("KunoChat native transfer listener stopped: {error}");
        }
    });
}

#[tauri::command]
pub async fn prepare_native_receive(
    app: AppHandle,
    service: State<'_, NativeTransferService>,
    transfer_id: String,
    message_id: String,
    expected_size: u64,
    key: String,
    save_folder: Option<String>,
) -> Result<NativeReceivePreparation, String> {
    validate_transfer_id(&transfer_id)?;
    if message_id.is_empty() || message_id.len() > 128 {
        return Err("invalid message id".to_string());
    }
    let key = parse_key(&key)?;
    let (part_path, size) = prepare_part_path(&transfer_id, expected_size, save_folder.as_deref())?;
    if size != 0 {
        return Err("native transfer resume requires the WebRTC fallback path".to_string());
    }

    let ticket = ReceiveTicket {
        message_id: message_id.clone(),
        expected_size,
        key,
        part_path,
        prepared_at: Instant::now(),
    };
    transfer_session::record(
        &app,
        DurableTransferSession {
            transfer_id: transfer_id.clone(),
            message_id,
            direction: "incoming".to_string(),
            status: "receiving".to_string(),
            expected_size,
            transferred_bytes: size,
            source_path: None,
            save_folder,
            sha256: None,
            peer_fingerprint: None,
            updated_at: 0,
        },
    )?;
    let mut pending_receives = service
        .pending_receives
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?;
    pending_receives.retain(|_, pending| pending.prepared_at.elapsed() <= RECEIVE_TICKET_TTL);
    pending_receives.insert(transfer_id, ticket);
    Ok(NativeReceivePreparation { size })
}

#[tauri::command]
pub async fn cancel_native_receive(
    app: AppHandle,
    service: State<'_, NativeTransferService>,
    transfer_id: String,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    service
        .pending_receives
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .remove(&transfer_id);
    transfer_session::remove(&app, &transfer_id)?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_native_send(
    app: AppHandle,
    service: State<'_, NativeTransferService>,
    transfer_id: String,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    service
        .cancelled_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .insert(transfer_id.clone());
    transfer_session::remove(&app, &transfer_id)?;
    Ok(())
}

#[tauri::command]
pub async fn pause_native_send(
    app: AppHandle,
    service: State<'_, NativeTransferService>,
    transfer_id: String,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    service
        .paused_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .insert(transfer_id.clone());
    transfer_session::update_status(&app, &transfer_id, "paused")?;
    Ok(())
}

#[tauri::command]
pub async fn resume_native_send(
    app: AppHandle,
    service: State<'_, NativeTransferService>,
    transfer_id: String,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    service
        .paused_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .remove(&transfer_id);
    transfer_session::update_status(&app, &transfer_id, "sending")?;
    Ok(())
}

#[tauri::command]
pub async fn send_native_file(
    service: State<'_, NativeTransferService>,
    app: AppHandle,
    transfer_id: String,
    message_id: String,
    path: String,
    remote_endpoint: String,
    expected_size: u64,
    key: String,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    if message_id.is_empty() || message_id.len() > 128 || expected_size > MAX_TRANSFER_BYTES {
        return Err("invalid native transfer metadata".to_string());
    }
    let key = parse_key(&key)?;
    service
        .cancelled_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .remove(&transfer_id);
    service
        .paused_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .remove(&transfer_id);
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !app.fs_scope().is_allowed(&path) {
        return Err("native source path is not authorized for transfer".to_string());
    }
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() != expected_size {
        return Err("native source file no longer matches its declared size".to_string());
    }
    if remote_endpoint.is_empty() || remote_endpoint.len() > 255 {
        return Err("invalid native transfer endpoint".to_string());
    }
    transfer_session::record(
        &app,
        DurableTransferSession {
            transfer_id: transfer_id.clone(),
            message_id: message_id.clone(),
            direction: "outgoing".to_string(),
            status: "sending".to_string(),
            expected_size,
            transferred_bytes: 0,
            source_path: Some(path.to_string_lossy().to_string()),
            save_folder: None,
            sha256: None,
            peer_fingerprint: None,
            updated_at: 0,
        },
    )?;

    let result = send_file_stream(
        &app,
        &transfer_id,
        &message_id,
        &path,
        &remote_endpoint,
        expected_size,
        key,
        service.inner(),
    )
    .await;
    if result.is_err() {
        let _ = transfer_session::update_status(&app, &transfer_id, "interrupted");
    }
    result
}

async fn run_listener(app: AppHandle, service: NativeTransferService) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", NATIVE_TRANSFER_PORT))
        .await
        .map_err(|error| {
            format!("cannot bind native transfer port {NATIVE_TRANSFER_PORT}: {error}")
        })?;
    eprintln!(
        "KunoChat native transfer listener listening on tcp://0.0.0.0:{NATIVE_TRANSFER_PORT}"
    );

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let Ok(permit) = service.incoming_connections.clone().try_acquire_owned() else {
            continue;
        };
        let app = app.clone();
        let service = service.clone();
        async_runtime::spawn(async move {
            let _permit = permit;
            if let Err(error) = receive_file_stream(&app, &service, stream).await {
                eprintln!("KunoChat native transfer connection failed: {error}");
            }
        });
    }
}

async fn send_file_stream(
    app: &AppHandle,
    transfer_id: &str,
    message_id: &str,
    path: &PathBuf,
    remote_endpoint: &str,
    expected_size: u64,
    key: [u8; 32],
    service: &NativeTransferService,
) -> Result<(), String> {
    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(remote_endpoint))
        .await
        .map_err(|_| "native transfer connection timed out".to_string())?
        .map_err(|error| format!("native transfer connection failed: {error}"))?;
    let nonce_prefix = next_connection_nonce();
    timeout(
        HANDSHAKE_TIMEOUT,
        write_handshake(&mut stream, transfer_id, nonce_prefix),
    )
    .await
    .map_err(|_| "native transfer connection timed out during handshake".to_string())?
    .map_err(|error| format!("native transfer connection failed: {error}"))?;
    await_native_accept(&mut stream).await?;

    let cipher = ChaCha20Poly1305::new((&key).into());
    let mut source = File::open(path).await.map_err(|error| error.to_string())?;
    let mut buffer = vec![0_u8; CHUNK_SIZE];
    let mut sequence = 0_u64;
    let mut sent = 0_u64;
    let mut last_reported = 0_u64;
    let mut last_persisted = 0_u64;

    loop {
        if take_cancelled_send(service, transfer_id)? {
            return Err("native transfer cancelled".to_string());
        }
        wait_while_paused(service, transfer_id).await?;
        if take_cancelled_send(service, transfer_id)? {
            return Err("native transfer cancelled".to_string());
        }
        let bytes_read = source
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes(nonce_prefix, sequence)),
                Payload {
                    msg: &buffer[..bytes_read],
                    aad: transfer_id.as_bytes(),
                },
            )
            .map_err(|_| "native transfer encryption failed".to_string())?;
        write_frame(&mut stream, &encrypted).await?;
        sequence = sequence
            .checked_add(1)
            .ok_or_else(|| "native transfer sequence overflow".to_string())?;
        sent = sent
            .checked_add(bytes_read as u64)
            .ok_or_else(|| "native transfer size overflow".to_string())?;
        if sent == expected_size || sent.saturating_sub(last_persisted) >= SESSION_PERSIST_INTERVAL
        {
            last_persisted = sent;
            transfer_session::update_progress(app, transfer_id, sent, "sending")?;
        }
        if sent == expected_size || sent.saturating_sub(last_reported) >= 256 * 1024 {
            last_reported = sent;
            emit_event(
                app,
                NativeTransferEvent {
                    message_id: message_id.to_string(),
                    transfer_id: transfer_id.to_string(),
                    direction: "outgoing".to_string(),
                    phase: "progress".to_string(),
                    transferred_bytes: sent,
                    total_bytes: expected_size,
                    message: None,
                },
            );
        }
    }
    if sent != expected_size {
        return Err("native source file changed during transfer".to_string());
    }
    write_frame(&mut stream, &[]).await?;
    stream.flush().await.map_err(|error| error.to_string())?;
    transfer_session::remove(app, transfer_id)?;
    emit_event(
        app,
        NativeTransferEvent {
            message_id: message_id.to_string(),
            transfer_id: transfer_id.to_string(),
            direction: "outgoing".to_string(),
            phase: "complete".to_string(),
            transferred_bytes: sent,
            total_bytes: expected_size,
            message: None,
        },
    );
    Ok(())
}

async fn receive_file_stream(
    app: &AppHandle,
    service: &NativeTransferService,
    mut stream: TcpStream,
) -> Result<(), String> {
    let (transfer_id, nonce_prefix) = timeout(HANDSHAKE_TIMEOUT, read_handshake(&mut stream))
        .await
        .map_err(|_| "native transfer handshake timed out".to_string())??;
    let ticket = service
        .pending_receives
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?
        .remove(&transfer_id)
        .ok_or_else(|| "no native transfer is awaiting this id".to_string())?;
    if ticket.prepared_at.elapsed() > RECEIVE_TICKET_TTL {
        return Err("native transfer receive ticket expired".to_string());
    }
    write_all(&mut stream, &[ACCEPT]).await?;
    stream.flush().await.map_err(|error| error.to_string())?;

    let result =
        receive_file_body(app, &transfer_id, nonce_prefix, ticket.clone(), &mut stream).await;
    if let Err(error) = &result {
        let received = std::fs::metadata(&ticket.part_path)
            .map(|metadata| metadata.len().min(ticket.expected_size))
            .unwrap_or_default();
        let status = if error.contains("authentication") || error.contains("exceeds") {
            "failed"
        } else {
            "interrupted"
        };
        let _ = transfer_session::update_progress(app, &transfer_id, received, status);
        emit_event(
            app,
            NativeTransferEvent {
                message_id: ticket.message_id,
                transfer_id,
                direction: "incoming".to_string(),
                phase: "failed".to_string(),
                transferred_bytes: 0,
                total_bytes: ticket.expected_size,
                message: Some(error.clone()),
            },
        );
    }
    result
}

async fn receive_file_body(
    app: &AppHandle,
    transfer_id: &str,
    nonce_prefix: u64,
    ticket: ReceiveTicket,
    stream: &mut TcpStream,
) -> Result<(), String> {
    let cipher = ChaCha20Poly1305::new((&ticket.key).into());
    let mut target = File::options()
        .append(true)
        .write(true)
        .open(&ticket.part_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut sequence = 0_u64;
    let mut received = 0_u64;
    let mut last_reported = 0_u64;
    let mut last_persisted = 0_u64;

    loop {
        let encrypted = read_frame(stream).await?;
        if encrypted.is_empty() {
            break;
        }
        let bytes = cipher
            .decrypt(
                Nonce::from_slice(&nonce_bytes(nonce_prefix, sequence)),
                Payload {
                    msg: &encrypted,
                    aad: transfer_id.as_bytes(),
                },
            )
            .map_err(|_| "native transfer authentication failed".to_string())?;
        let next = received
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "native transfer size overflow".to_string())?;
        if next > ticket.expected_size {
            return Err("native transfer exceeds the declared size".to_string());
        }
        target
            .write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
        sequence = sequence
            .checked_add(1)
            .ok_or_else(|| "native transfer sequence overflow".to_string())?;
        received = next;
        if received == ticket.expected_size
            || received.saturating_sub(last_persisted) >= SESSION_PERSIST_INTERVAL
        {
            last_persisted = received;
            transfer_session::update_progress(app, transfer_id, received, "receiving")?;
        }
        if received == ticket.expected_size || received.saturating_sub(last_reported) >= 256 * 1024
        {
            last_reported = received;
            emit_event(
                app,
                NativeTransferEvent {
                    message_id: ticket.message_id.clone(),
                    transfer_id: transfer_id.to_string(),
                    direction: "incoming".to_string(),
                    phase: "progress".to_string(),
                    transferred_bytes: received,
                    total_bytes: ticket.expected_size,
                    message: None,
                },
            );
        }
    }

    target.flush().await.map_err(|error| error.to_string())?;
    target
        .sync_data()
        .await
        .map_err(|error| error.to_string())?;
    if received != ticket.expected_size {
        return Err("native transfer ended before the declared size".to_string());
    }
    transfer_session::remove(app, transfer_id)?;
    emit_event(
        app,
        NativeTransferEvent {
            message_id: ticket.message_id,
            transfer_id: transfer_id.to_string(),
            direction: "incoming".to_string(),
            phase: "complete".to_string(),
            transferred_bytes: received,
            total_bytes: ticket.expected_size,
            message: None,
        },
    );
    Ok(())
}

async fn write_handshake(
    stream: &mut TcpStream,
    transfer_id: &str,
    nonce_prefix: u64,
) -> Result<(), String> {
    let id = transfer_id.as_bytes();
    if id.len() > 128 {
        return Err("invalid transfer id".to_string());
    }
    write_all(stream, MAGIC).await?;
    write_all(stream, &[id.len() as u8]).await?;
    write_all(stream, id).await?;
    write_all(stream, &nonce_prefix.to_be_bytes()).await?;
    Ok(())
}

async fn await_native_accept(stream: &mut TcpStream) -> Result<(), String> {
    let mut accept = [0_u8; 1];
    timeout(HANDSHAKE_TIMEOUT, stream.read_exact(&mut accept))
        .await
        .map_err(|_| "native transfer connection timed out waiting for receiver".to_string())?
        .map_err(|error| format!("native transfer connection failed: {error}"))?;
    if accept[0] != ACCEPT {
        return Err("native transfer connection was rejected by receiver".to_string());
    }
    Ok(())
}

async fn read_handshake(stream: &mut TcpStream) -> Result<(String, u64), String> {
    let mut magic = [0_u8; MAGIC.len()];
    read_exact(stream, &mut magic).await?;
    if &magic != MAGIC {
        return Err("invalid native transfer protocol".to_string());
    }
    let mut id_len = [0_u8; 1];
    read_exact(stream, &mut id_len).await?;
    let id_len = id_len[0] as usize;
    if id_len == 0 || id_len > 128 {
        return Err("invalid native transfer id length".to_string());
    }
    let mut id = vec![0_u8; id_len];
    read_exact(stream, &mut id).await?;
    let transfer_id =
        String::from_utf8(id).map_err(|_| "invalid native transfer id encoding".to_string())?;
    validate_transfer_id(&transfer_id)?;
    let mut nonce_prefix = [0_u8; 8];
    read_exact(stream, &mut nonce_prefix).await?;
    let nonce_prefix = u64::from_be_bytes(nonce_prefix);
    Ok((transfer_id, nonce_prefix))
}

async fn write_frame(stream: &mut TcpStream, frame: &[u8]) -> Result<(), String> {
    if frame.len() > MAX_FRAME_BYTES {
        return Err("native transfer frame is too large".to_string());
    }
    write_all(stream, &(frame.len() as u32).to_be_bytes()).await?;
    if !frame.is_empty() {
        write_all(stream, frame).await?;
    }
    Ok(())
}

async fn read_frame(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut length = [0_u8; 4];
    read_exact(stream, &mut length).await?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_FRAME_BYTES {
        return Err("native transfer frame is too large".to_string());
    }
    let mut frame = vec![0_u8; length];
    if length > 0 {
        read_exact(stream, &mut frame).await?;
    }
    Ok(frame)
}

async fn write_all(stream: &mut TcpStream, bytes: &[u8]) -> Result<(), String> {
    timeout(FRAME_IDLE_TIMEOUT, stream.write_all(bytes))
        .await
        .map_err(|_| "native transfer write timed out".to_string())?
        .map_err(|error| error.to_string())
}

async fn read_exact(stream: &mut TcpStream, bytes: &mut [u8]) -> Result<(), String> {
    timeout(FRAME_IDLE_TIMEOUT, stream.read_exact(bytes))
        .await
        .map_err(|_| "native transfer read timed out".to_string())?
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn nonce_bytes(prefix: u64, sequence: u64) -> [u8; 12] {
    let sequence =
        u32::try_from(sequence).expect("10 GiB transfer limit keeps sequence within u32");
    let mut bytes = [0_u8; 12];
    bytes[..8].copy_from_slice(&prefix.to_be_bytes());
    bytes[8..].copy_from_slice(&sequence.to_be_bytes());
    bytes
}

fn next_connection_nonce() -> u64 {
    NEXT_CONNECTION_NONCE.fetch_add(1, Ordering::Relaxed)
}

fn parse_key(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid native transfer key".to_string());
    }
    let mut key = [0_u8; 32];
    for (index, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| "invalid native transfer key".to_string())?;
    }
    Ok(key)
}

fn emit_event(app: &AppHandle, event: NativeTransferEvent) {
    let _ = app.emit("kuno:native-transfer", event);
}

fn take_cancelled_send(service: &NativeTransferService, transfer_id: &str) -> Result<bool, String> {
    let mut cancelled = service
        .cancelled_sends
        .lock()
        .map_err(|_| "native transfer state lock poisoned".to_string())?;
    Ok(cancelled.remove(transfer_id))
}

async fn wait_while_paused(
    service: &NativeTransferService,
    transfer_id: &str,
) -> Result<(), String> {
    loop {
        if take_cancelled_send(service, transfer_id)? {
            return Err("native transfer cancelled".to_string());
        }
        let paused = service
            .paused_sends
            .lock()
            .map_err(|_| "native transfer state lock poisoned".to_string())?
            .contains(transfer_id);
        if !paused {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        await_native_accept, nonce_bytes, parse_key, read_handshake, write_all, write_handshake,
        ACCEPT,
    };
    use chacha20poly1305::{
        aead::{Aead, KeyInit, Payload},
        ChaCha20Poly1305, Nonce,
    };

    #[test]
    fn parses_a_256_bit_hex_key() {
        assert_eq!(parse_key(&"ab".repeat(32)).expect("key")[0], 0xab);
    }

    #[test]
    fn rejects_invalid_native_keys() {
        assert!(parse_key("short").is_err());
        assert!(parse_key(&"z".repeat(64)).is_err());
    }

    #[test]
    fn nonce_combines_connection_and_sequence() {
        let nonce = nonce_bytes(0x0102030405060708, 9);
        assert_eq!(&nonce[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(nonce[11], 9);
    }

    #[test]
    fn receiver_acceptance_confirms_the_native_handshake_before_file_bytes() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("listener");
            let address = listener.local_addr().expect("listener address");
            let server = tauri::async_runtime::spawn(async move {
                let (mut stream, _) = listener.accept().await.expect("connection");
                let (transfer_id, nonce) = read_handshake(&mut stream).await.expect("handshake");
                assert_eq!(transfer_id, "transfer_01");
                assert_eq!(nonce, 0x1020304050607080);
                write_all(&mut stream, &[ACCEPT]).await.expect("accept");
            });

            let mut client = tokio::net::TcpStream::connect(address)
                .await
                .expect("client");
            write_handshake(&mut client, "transfer_01", 0x1020304050607080)
                .await
                .expect("write handshake");
            await_native_accept(&mut client)
                .await
                .expect("receiver accept");
            server.await.expect("server task");
        });
    }

    #[test]
    fn transfer_frame_authenticates_its_payload_and_transfer_id() {
        let key = parse_key(&"5a".repeat(32)).expect("key");
        let cipher = ChaCha20Poly1305::new((&key).into());
        let nonce = nonce_bytes(7, 3);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: b"native bytes",
                    aad: b"transfer_01",
                },
            )
            .expect("encrypt");
        assert_eq!(
            cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: b"transfer_01",
                    },
                )
                .expect("decrypt"),
            b"native bytes"
        );
        assert!(cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: b"other_transfer",
                },
            )
            .is_err());
    }
}
