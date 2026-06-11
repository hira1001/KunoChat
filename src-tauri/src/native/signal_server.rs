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
