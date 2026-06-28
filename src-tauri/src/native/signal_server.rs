use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{async_runtime, AppHandle, Emitter, Manager};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{
        mpsc::{channel, Sender},
        Semaphore,
    },
    time::timeout,
};
use tokio_tungstenite::{
    accept_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
};

type Rooms = Arc<Mutex<HashMap<String, HashMap<String, Peer>>>>;
static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);
const MAX_SIGNAL_MESSAGE_BYTES: usize = 64 * 1024;
const SIGNAL_QUEUE_CAPACITY: usize = 64;
const MAX_SIGNAL_CONNECTIONS: usize = 64;
const SIGNAL_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(6);
const SIGNAL_RATE_WINDOW: Duration = Duration::from_secs(10);
const MAX_SIGNAL_MESSAGES_PER_WINDOW: u32 = 120;

#[derive(Clone)]
struct Peer {
    peer_id: String,
    display_name: String,
    connection_id: u64,
    tx: Sender<Message>,
}

pub fn start(app: AppHandle, port: u16) {
    async_runtime::spawn(async move {
        if let Err(error) = run_server(app, port).await {
            eprintln!("KunoChat embedded signaling server stopped: {error}");
        }
    });
}

async fn run_server(app: AppHandle, port: u16) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| format!("cannot bind signaling server on port {port}: {error}"))?;
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let connections = Arc::new(Semaphore::new(MAX_SIGNAL_CONNECTIONS));
    eprintln!("KunoChat embedded signaling server listening on ws://0.0.0.0:{port}");

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let Ok(permit) = connections.clone().try_acquire_owned() else {
            continue;
        };
        let rooms = rooms.clone();
        let app = app.clone();
        async_runtime::spawn(async move {
            let _permit = permit;
            if let Err(error) = handle_connection(app, stream, rooms).await {
                eprintln!("KunoChat signaling connection ended: {error}");
            }
        });
    }
}

async fn handle_connection(app: AppHandle, stream: TcpStream, rooms: Rooms) -> Result<(), String> {
    let remote_ip = stream
        .peer_addr()
        .ok()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_default();
    let websocket_config = WebSocketConfig::default()
        .max_message_size(Some(MAX_SIGNAL_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SIGNAL_MESSAGE_BYTES));
    let websocket = timeout(
        SIGNAL_HANDSHAKE_TIMEOUT,
        accept_async_with_config(stream, Some(websocket_config)),
    )
    .await
    .map_err(|_| "signaling WebSocket handshake timed out".to_string())?
    .map_err(|error| error.to_string())?;
    let (mut write, mut read) = websocket.split();
    let (tx, mut rx) = channel::<Message>(SIGNAL_QUEUE_CAPACITY);
    let writer = async_runtime::spawn(async move {
        while let Some(message) = rx.recv().await {
            if write.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut current_room = String::new();
    let mut current_peer = String::new();
    let connection_id = NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed);
    let mut rate_window_started = Instant::now();
    let mut messages_in_window = 0_u32;

    while let Some(raw) = read.next().await {
        if exceeds_rate_limit(
            &mut rate_window_started,
            &mut messages_in_window,
            Instant::now(),
        ) {
            send_json(
                &tx,
                json!({ "type": "error", "message": "signaling rate limit exceeded." }),
            );
            return Err("signaling rate limit exceeded".to_string());
        }
        let raw = raw.map_err(|error| error.to_string())?;
        if raw.is_close() {
            break;
        }
        if !raw.is_text() {
            continue;
        }
        let raw_text = raw.to_text().map_err(|error| error.to_string())?;
        if raw_text.len() > MAX_SIGNAL_MESSAGE_BYTES {
            send_json(
                &tx,
                json!({ "type": "error", "message": "signaling message is too large." }),
            );
            continue;
        }

        let message: Value =
            serde_json::from_str(raw_text).map_err(|_| "invalid JSON".to_string())?;
        let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");

        if message_type == "connection-request" {
            let request_id = message
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(128)
                .collect::<String>();
            let room_id =
                normalize_room_id(message.get("roomId").and_then(Value::as_str).unwrap_or(""));
            let requester_name = message
                .get("requesterName")
                .and_then(Value::as_str)
                .unwrap_or("Peer")
                .chars()
                .take(80)
                .collect::<String>();
            let requester_peer_id = message
                .get("requesterPeerId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(128)
                .collect::<String>();

            if request_id.is_empty() || room_id.is_empty() || !is_valid_peer_id(&requester_peer_id)
            {
                send_json(
                    &tx,
                    json!({ "type": "error", "message": "invalid connection request." }),
                );
                continue;
            }

            let payload = json!({
                "requestId": request_id,
                "roomId": room_id,
                "requesterName": requester_name,
                "requesterPeerId": requester_peer_id,
                "peerHint": remote_ip
            });
            let _ = app.emit("kuno:connection-request", payload);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("kuno:navigate", "main");
            }
            send_json(&tx, json!({ "type": "connection-request-ack", "requestId": request_id }));
            continue;
        }

        if message_type == "join" {
            let next_room =
                normalize_room_id(message.get("roomId").and_then(Value::as_str).unwrap_or(""));
            let next_peer = message
                .get("peerId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let display_name: String = message
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or("Peer")
                .chars()
                .take(80)
                .collect();

            if next_room.is_empty() || !is_valid_peer_id(&next_peer) {
                send_json(
                    &tx,
                    json!({ "type": "error", "message": "roomId and peerId are required." }),
                );
                continue;
            }

            if !current_room.is_empty()
                && (current_room != next_room || current_peer != next_peer)
                && leave_room(&rooms, &current_room, &current_peer, connection_id)
            {
                broadcast(
                    &rooms,
                    &current_room,
                    &current_peer,
                    json!({ "type": "peer-left", "peerId": current_peer }),
                );
            }

            current_room = next_room;
            current_peer = next_peer;

            let existing_peers = join_room(
                &rooms,
                &current_room,
                Peer {
                    peer_id: current_peer.clone(),
                    display_name: display_name.clone(),
                    connection_id,
                    tx: tx.clone(),
                },
            )?;
            send_json(&tx, json!({ "type": "peers", "peers": existing_peers }));
            broadcast(
                &rooms,
                &current_room,
                &current_peer,
                json!({
                    "type": "peer-joined",
                    "peer": {
                        "peerId": current_peer,
                        "displayName": display_name
                    }
                }),
            );
            continue;
        }

        if current_room.is_empty() || current_peer.is_empty() {
            send_json(
                &tx,
                json!({ "type": "error", "message": "Join a room before signaling." }),
            );
            continue;
        }

        if matches!(message_type, "offer" | "answer" | "ice") {
            broadcast(
                &rooms,
                &current_room,
                &current_peer,
                json!({
                    "type": message_type,
                    "from": current_peer,
                    "payload": message.get("payload").cloned().unwrap_or(Value::Null)
                }),
            );
        }
    }

    if leave_room(&rooms, &current_room, &current_peer, connection_id) {
        broadcast(
            &rooms,
            &current_room,
            &current_peer,
            json!({ "type": "peer-left", "peerId": current_peer }),
        );
    }
    writer.abort();
    Ok(())
}

fn exceeds_rate_limit(
    window_started: &mut Instant,
    messages_in_window: &mut u32,
    now: Instant,
) -> bool {
    if now.duration_since(*window_started) >= SIGNAL_RATE_WINDOW {
        *window_started = now;
        *messages_in_window = 0;
    }
    *messages_in_window = messages_in_window.saturating_add(1);
    *messages_in_window > MAX_SIGNAL_MESSAGES_PER_WINDOW
}

fn join_room(rooms: &Rooms, room_id: &str, peer: Peer) -> Result<Vec<Value>, String> {
    let mut rooms = rooms.lock().map_err(|_| "room lock poisoned".to_string())?;
    let room = rooms
        .entry(room_id.to_string())
        .or_insert_with(HashMap::new);

    if !room.contains_key(&peer.peer_id) && room.len() >= 2 {
        send_json(
            &peer.tx,
            json!({ "type": "error", "message": "This KunoChat room already has two peers." }),
        );
        return Err("room full".to_string());
    }

    let existing_peers = room
        .values()
        .filter(|existing| existing.peer_id != peer.peer_id)
        .map(peer_summary)
        .collect();
    room.insert(peer.peer_id.clone(), peer);
    Ok(existing_peers)
}

fn leave_room(rooms: &Rooms, room_id: &str, peer_id: &str, connection_id: u64) -> bool {
    if room_id.is_empty() || peer_id.is_empty() {
        return false;
    }

    let Ok(mut rooms) = rooms.lock() else {
        return false;
    };
    let Some(room) = rooms.get_mut(room_id) else {
        return false;
    };

    let Some(peer) = room.get(peer_id) else {
        return false;
    };
    if peer.connection_id != connection_id {
        return false;
    }

    room.remove(peer_id);
    if room.is_empty() {
        rooms.remove(room_id);
    }
    true
}

fn broadcast(rooms: &Rooms, room_id: &str, sender_id: &str, message: Value) {
    if room_id.is_empty() || sender_id.is_empty() {
        return;
    }

    let Ok(rooms) = rooms.lock() else {
        return;
    };
    let Some(room) = rooms.get(room_id) else {
        return;
    };

    for peer in room.values() {
        if peer.peer_id != sender_id {
            send_json(&peer.tx, message.clone());
        }
    }
}

fn send_json(tx: &Sender<Message>, value: Value) {
    let _ = tx.try_send(Message::Text(value.to_string().into()));
}

fn normalize_room_id(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).take(6).collect()
}

fn is_valid_peer_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn peer_summary(peer: &Peer) -> Value {
    json!({
        "peerId": peer.peer_id,
        "displayName": peer.display_name
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(peer_id: &str, display_name: &str) -> (Peer, tokio::sync::mpsc::Receiver<Message>) {
        let (tx, rx) = channel(SIGNAL_QUEUE_CAPACITY);
        (
            Peer {
                peer_id: peer_id.to_string(),
                display_name: display_name.to_string(),
                connection_id: NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed),
                tx,
            },
            rx,
        )
    }

    #[test]
    fn signal_rate_limit_resets_after_its_window() {
        let now = Instant::now();
        let mut started = now;
        let mut count = MAX_SIGNAL_MESSAGES_PER_WINDOW;
        assert!(exceeds_rate_limit(&mut started, &mut count, now));
        assert!(!exceeds_rate_limit(
            &mut started,
            &mut count,
            now + SIGNAL_RATE_WINDOW
        ));
    }

    #[test]
    fn normalize_room_id_keeps_digits_only() {
        assert_eq!(normalize_room_id("739-216"), "739216");
    }

    #[test]
    fn normalize_room_id_limits_to_six_digits() {
        assert_eq!(normalize_room_id("123456789"), "123456");
    }

    #[test]
    fn normalize_room_id_drops_letters() {
        assert_eq!(normalize_room_id("ab12cd34ef56"), "123456");
    }

    #[test]
    fn normalize_room_id_allows_empty_result() {
        assert_eq!(normalize_room_id("abc"), "");
    }

    #[test]
    fn peer_id_rejects_unbounded_and_path_like_values() {
        assert!(is_valid_peer_id("peer_01-a"));
        assert!(!is_valid_peer_id("../peer"));
        assert!(!is_valid_peer_id(&"x".repeat(129)));
    }

    #[test]
    fn peer_summary_contains_public_fields_only() {
        let (alice, _rx) = peer("alice", "Alice");
        assert_eq!(
            peer_summary(&alice),
            json!({ "peerId": "alice", "displayName": "Alice" })
        );
    }

    #[test]
    fn first_join_gets_no_existing_peers() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (alice, _rx) = peer("alice", "Alice");
        let existing = join_room(&rooms, "123456", alice).expect("join should work");
        assert!(existing.is_empty());
    }

    #[test]
    fn second_join_gets_first_peer_summary() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (alice, _alice_rx) = peer("alice", "Alice");
        let (bob, _bob_rx) = peer("bob", "Bob");
        join_room(&rooms, "123456", alice).expect("first join should work");
        let existing = join_room(&rooms, "123456", bob).expect("second join should work");
        assert_eq!(
            existing,
            vec![json!({ "peerId": "alice", "displayName": "Alice" })]
        );
    }

    #[test]
    fn room_rejects_third_distinct_peer() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (alice, _alice_rx) = peer("alice", "Alice");
        let (bob, _bob_rx) = peer("bob", "Bob");
        let (charlie, _charlie_rx) = peer("charlie", "Charlie");
        join_room(&rooms, "123456", alice).expect("first join should work");
        join_room(&rooms, "123456", bob).expect("second join should work");
        assert!(join_room(&rooms, "123456", charlie).is_err());
    }

    #[test]
    fn same_peer_can_rejoin_full_room() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (alice, _alice_rx) = peer("alice", "Alice");
        let (bob, _bob_rx) = peer("bob", "Bob");
        let (alice_again, _alice_again_rx) = peer("alice", "Alice 2");
        join_room(&rooms, "123456", alice).expect("first join should work");
        join_room(&rooms, "123456", bob).expect("second join should work");
        assert!(join_room(&rooms, "123456", alice_again).is_ok());
    }

    #[test]
    fn leave_room_removes_empty_room() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (alice, _alice_rx) = peer("alice", "Alice");
        join_room(&rooms, "123456", alice).expect("join should work");
        let connection_id = rooms
            .lock()
            .expect("lock")
            .get("123456")
            .expect("room")
            .get("alice")
            .expect("peer")
            .connection_id;
        assert!(leave_room(&rooms, "123456", "alice", connection_id));
        assert!(rooms.lock().expect("lock").get("123456").is_none());
    }

    #[test]
    fn stale_connection_cannot_remove_a_reconnected_peer() {
        let rooms = Arc::new(Mutex::new(HashMap::new()));
        let (first, _first_rx) = peer("alice", "Alice");
        let first_connection_id = first.connection_id;
        let (second, _second_rx) = peer("alice", "Alice");
        let second_connection_id = second.connection_id;
        join_room(&rooms, "123456", first).expect("first join should work");
        join_room(&rooms, "123456", second).expect("reconnect should work");

        assert!(!leave_room(&rooms, "123456", "alice", first_connection_id));
        assert!(rooms.lock().expect("lock").get("123456").is_some());
        assert!(leave_room(&rooms, "123456", "alice", second_connection_id));
    }
}
