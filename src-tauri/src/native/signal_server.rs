use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::async_runtime;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::mpsc::{unbounded_channel, UnboundedSender},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

type Rooms = Arc<Mutex<HashMap<String, HashMap<String, Peer>>>>;

#[derive(Clone)]
struct Peer {
    peer_id: String,
    display_name: String,
    tx: UnboundedSender<Message>,
}

pub fn start(port: u16) {
    async_runtime::spawn(async move {
        if let Err(error) = run_server(port).await {
            eprintln!("KunoChat embedded signaling server stopped: {error}");
        }
    });
}

async fn run_server(port: u16) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| format!("cannot bind signaling server on port {port}: {error}"))?;
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    eprintln!("KunoChat embedded signaling server listening on ws://0.0.0.0:{port}");

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let rooms = rooms.clone();
        async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, rooms).await {
                eprintln!("KunoChat signaling connection ended: {error}");
            }
        });
    }
}

async fn handle_connection(stream: TcpStream, rooms: Rooms) -> Result<(), String> {
    let websocket = accept_async(stream).await.map_err(|error| error.to_string())?;
    let (mut write, mut read) = websocket.split();
    let (tx, mut rx) = unbounded_channel::<Message>();
    let writer = async_runtime::spawn(async move {
        while let Some(message) = rx.recv().await {
            if write.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut current_room = String::new();
    let mut current_peer = String::new();

    while let Some(raw) = read.next().await {
        let raw = raw.map_err(|error| error.to_string())?;
        if raw.is_close() {
            break;
        }
        if !raw.is_text() {
            continue;
        }

        let message: Value = serde_json::from_str(raw.to_text().map_err(|error| error.to_string())?)
            .map_err(|_| "invalid JSON".to_string())?;
        let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");

        if message_type == "join" {
            current_room = normalize_room_id(message.get("roomId").and_then(Value::as_str).unwrap_or(""));
            current_peer = message
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

            if current_room.is_empty() || current_peer.is_empty() {
                send_json(&tx, json!({ "type": "error", "message": "roomId and peerId are required." }));
                continue;
            }

            let existing_peers = join_room(
                &rooms,
                &current_room,
                Peer {
                    peer_id: current_peer.clone(),
                    display_name: display_name.clone(),
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
            send_json(&tx, json!({ "type": "error", "message": "Join a room before signaling." }));
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

    leave_room(&rooms, &current_room, &current_peer);
    broadcast(
        &rooms,
        &current_room,
        &current_peer,
        json!({ "type": "peer-left", "peerId": current_peer }),
    );
    writer.abort();
    Ok(())
}

fn join_room(rooms: &Rooms, room_id: &str, peer: Peer) -> Result<Vec<Value>, String> {
    let mut rooms = rooms.lock().map_err(|_| "room lock poisoned".to_string())?;
    let room = rooms.entry(room_id.to_string()).or_insert_with(HashMap::new);

    if !room.contains_key(&peer.peer_id) && room.len() >= 5 {
        send_json(
            &peer.tx,
            json!({ "type": "error", "message": "This KunoChat room already has five peers." }),
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

fn leave_room(rooms: &Rooms, room_id: &str, peer_id: &str) {
    if room_id.is_empty() || peer_id.is_empty() {
        return;
    }

    let Ok(mut rooms) = rooms.lock() else {
        return;
    };
    let Some(room) = rooms.get_mut(room_id) else {
        return;
    };

    room.remove(peer_id);
    if room.is_empty() {
        rooms.remove(room_id);
    }
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

fn send_json(tx: &UnboundedSender<Message>, value: Value) {
    let _ = tx.send(Message::Text(value.to_string().into()));
}

fn normalize_room_id(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).take(6).collect()
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

    fn peer(peer_id: &str, display_name: &str) -> (Peer, tokio::sync::mpsc::UnboundedReceiver<Message>) {
        let (tx, rx) = unbounded_channel();
        (
            Peer {
                peer_id: peer_id.to_string(),
                display_name: display_name.to_string(),
                tx,
            },
            rx,
        )
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
    fn peer_summary_contains_public_fields_only() {
        let (alice, _rx) = peer("alice", "Alice");
        assert_eq!(peer_summary(&alice), json!({ "peerId": "alice", "displayName": "Alice" }));
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
        assert_eq!(existing, vec![json!({ "peerId": "alice", "displayName": "Alice" })]);
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
        leave_room(&rooms, "123456", "alice");
        assert!(rooms.lock().expect("lock").get("123456").is_none());
    }
}
