use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket as StdUdpSocket},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::{net::UdpSocket, time};

const DISCOVERY_PORT: u16 = 8788;
const SIGNALING_PORT: u16 = 8787;

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
    let mut last_peer = String::new();

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
                if dedupe_key == last_peer {
                    continue;
                }
                last_peer = dedupe_key;

                let _ = app.emit(
                    "kuno:auto-connect",
                    AutoConnectPayload {
                        signaling_url: format!("ws://{server_ip}:{SIGNALING_PORT}"),
                        room_id,
                        mode: mode.to_string(),
                        peer_hint: remote_ip.to_string(),
                    },
                );
            }
        }
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
