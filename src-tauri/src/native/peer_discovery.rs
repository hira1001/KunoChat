use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket as StdUdpSocket},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::{net::UdpSocket, time};

const DISCOVERY_PORT: u16 = 8788;
const SIGNALING_PORT: u16 = 8787;
const REEMIT_AFTER: Duration = Duration::from_secs(3);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryMessage {
    app: String,
    instance_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoConnectPayload {
    signaling_url: String,
    room_id: String,
    mode: String,
    peer_hint: String,
    source: String,
}

pub fn start(app: AppHandle) {
    async_runtime::spawn(async move {
        if let Err(error) = run_discovery(app).await {
            eprintln!("KunoChat peer discovery stopped: {error}");
        }
    });
}

async fn run_discovery(app: AppHandle) -> Result<(), String> {
    let instance_id = create_instance_id();
    let std_socket = StdUdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).map_err(|error| error.to_string())?;
    std_socket
        .set_broadcast(true)
        .map_err(|error| error.to_string())?;
    std_socket
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let socket = UdpSocket::from_std(std_socket).map_err(|error| error.to_string())?;
    let broadcast_addr = SocketAddr::from((Ipv4Addr::BROADCAST, DISCOVERY_PORT));
    let own_message = serde_json::to_vec(&DiscoveryMessage {
        app: "KunoChat".to_string(),
        instance_id: instance_id.clone(),
    })
    .map_err(|error| error.to_string())?;
    let mut interval = time::interval(Duration::from_millis(900));
    let mut buffer = [0_u8; 512];
    let mut last_peer: Option<(String, Instant)> = None;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let _ = socket.send_to(&own_message, broadcast_addr).await;
            }
            received = socket.recv_from(&mut buffer) => {
                let Ok((length, remote_addr)) = received else {
                    continue;
                };
                let Ok(message) = serde_json::from_slice::<DiscoveryMessage>(&buffer[..length]) else {
                    continue;
                };
                if message.app != "KunoChat" || message.instance_id == instance_id {
                    continue;
                }

                let Some(local_ip) = local_ip_for_peer(remote_addr) else {
                    continue;
                };
                let IpAddr::V4(remote_ip) = remote_addr.ip() else {
                    continue;
                };
                let IpAddr::V4(local_ip) = local_ip else {
                    continue;
                };

                let room_id = room_id_for_pair(&instance_id, &message.instance_id);
                let server_ip = if ipv4_number(local_ip) <= ipv4_number(remote_ip) {
                    local_ip
                } else {
                    remote_ip
                };
                let mode = if server_ip == local_ip { "host" } else { "join" };
                let dedupe_key = format!("{server_ip}:{room_id}:{mode}");
                if !should_emit_peer(&last_peer, &dedupe_key, Instant::now()) {
                    continue;
                }
                last_peer = Some((dedupe_key, Instant::now()));

                let _ = app.emit(
                    "kuno:auto-connect",
                    AutoConnectPayload {
                        signaling_url: format!("ws://{server_ip}:{SIGNALING_PORT}"),
                        room_id,
                        mode: mode.to_string(),
                        peer_hint: remote_ip.to_string(),
                        source: "lan".to_string(),
                    },
                );
            }
        }
    }
}

fn should_emit_peer(last_peer: &Option<(String, Instant)>, dedupe_key: &str, now: Instant) -> bool {
    match last_peer {
        Some((last_key, last_seen)) if last_key == dedupe_key => now.duration_since(*last_seen) >= REEMIT_AFTER,
        _ => true,
    }
}

fn create_instance_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("{}-{now}", std::process::id())
}

fn local_ip_for_peer(remote_addr: SocketAddr) -> Option<IpAddr> {
    let socket = StdUdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(remote_addr).ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

fn ipv4_number(ip: Ipv4Addr) -> u32 {
    u32::from_be_bytes(ip.octets())
}

fn room_id_for_pair(left: &str, right: &str) -> String {
    let (first, second) = if left <= right { (left, right) } else { (right, left) };
    let mut hash = 2_166_136_261_u32;
    for byte in first.bytes().chain(second.bytes()) {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("{:06}", hash % 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipv4_number_preserves_ordering() {
        assert!(ipv4_number(Ipv4Addr::new(192, 168, 1, 2)) < ipv4_number(Ipv4Addr::new(192, 168, 1, 3)));
    }

    #[test]
    fn ipv4_number_distinguishes_network_octets() {
        assert!(ipv4_number(Ipv4Addr::new(10, 0, 0, 9)) < ipv4_number(Ipv4Addr::new(10, 0, 1, 1)));
    }

    #[test]
    fn room_id_for_pair_is_symmetric() {
        assert_eq!(room_id_for_pair("left", "right"), room_id_for_pair("right", "left"));
    }

    #[test]
    fn room_id_for_pair_is_six_digits() {
        let room_id = room_id_for_pair("a", "b");
        assert_eq!(room_id.len(), 6);
        assert!(room_id.chars().all(|char| char.is_ascii_digit()));
    }

    #[test]
    fn room_id_for_pair_changes_for_different_pair() {
        assert_ne!(room_id_for_pair("a", "b"), room_id_for_pair("a", "c"));
    }

    #[test]
    fn discovery_message_serializes_camel_case() {
        let message = DiscoveryMessage {
            app: "KunoChat".to_string(),
            instance_id: "abc".to_string(),
        };
        let value = serde_json::to_value(message).expect("serialize");
        assert_eq!(value, serde_json::json!({ "app": "KunoChat", "instanceId": "abc" }));
    }

    #[test]
    fn auto_connect_payload_serializes_camel_case() {
        let payload = AutoConnectPayload {
            signaling_url: "ws://127.0.0.1:8787".to_string(),
            room_id: "123456".to_string(),
            mode: "host".to_string(),
            peer_hint: "127.0.0.2".to_string(),
            source: "lan".to_string(),
        };
        let value = serde_json::to_value(payload).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "signalingUrl": "ws://127.0.0.1:8787",
                "roomId": "123456",
                "mode": "host",
                "peerHint": "127.0.0.2",
                "source": "lan"
            })
        );
    }

    #[test]
    fn should_emit_new_peer_immediately() {
        let now = Instant::now();
        let last_peer = Some(("old".to_string(), now));
        assert!(should_emit_peer(&last_peer, "new", now));
    }

    #[test]
    fn should_suppress_same_peer_until_reemit_window() {
        let now = Instant::now();
        let last_peer = Some(("same".to_string(), now));
        assert!(!should_emit_peer(&last_peer, "same", now + Duration::from_secs(1)));
    }

    #[test]
    fn should_reemit_same_peer_after_reemit_window() {
        let now = Instant::now();
        let last_peer = Some(("same".to_string(), now));
        assert!(should_emit_peer(&last_peer, "same", now + REEMIT_AFTER));
    }
}
