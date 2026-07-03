use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    process::Command,
    time::{Duration, Instant},
};
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::time;

const SIGNALING_PORT: u16 = 8787;
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(2);
const DISCOVERY_ERROR_BACKOFF: Duration = Duration::from_secs(60);
const REEMIT_AFTER: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleStatus {
    #[serde(rename = "Self")]
    self_node: TailscaleNode,
    #[serde(default)]
    peer: HashMap<String, TailscaleNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleNode {
    #[serde(rename = "ID")]
    #[serde(default)]
    id: String,
    #[serde(rename = "DNSName")]
    #[serde(default)]
    dns_name: String,
    #[serde(rename = "TailscaleIPs")]
    #[serde(default)]
    tailscale_ips: Vec<String>,
    #[serde(rename = "OS")]
    #[serde(default)]
    os: String,
    #[serde(default)]
    online: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoConnectPayload {
    signaling_url: String,
    room_id: String,
    mode: String,
    peer_hint: String,
    source: String,
    device_name: Option<String>,
    platform: Option<String>,
}

struct TailscaleCandidate {
    signaling_url: String,
    room_id: String,
    mode: String,
    peer_hint: String,
    probe_host: String,
    device_name: Option<String>,
    platform: Option<String>,
}

pub fn start(app: AppHandle) {
    async_runtime::spawn(async move {
        run_discovery(app).await;
    });
}

async fn run_discovery(app: AppHandle) {
    let mut interval = time::interval(DISCOVERY_INTERVAL);
    let mut last_candidate: Option<(String, Instant)> = None;
    let mut next_status_attempt = Instant::now();

    loop {
        interval.tick().await;

        let now = Instant::now();
        if now < next_status_attempt {
            continue;
        }

        let Ok(status) = read_tailscale_status() else {
            next_status_attempt = now + DISCOVERY_ERROR_BACKOFF;
            continue;
        };
        next_status_attempt = now + DISCOVERY_INTERVAL;
        for candidate in select_candidates(&status) {
            if !is_kunochat_reachable(&candidate.probe_host) {
                continue;
            }

            let key = format!(
                "{}:{}:{}",
                candidate.signaling_url, candidate.room_id, candidate.mode
            );
            let now = Instant::now();
            if !should_emit_candidate(&last_candidate, &key, now) {
                continue;
            }
            last_candidate = Some((key, now));

            let _ = app.emit(
                "kuno:auto-connect",
                AutoConnectPayload {
                    signaling_url: candidate.signaling_url,
                    room_id: candidate.room_id,
                    mode: candidate.mode,
                    peer_hint: candidate.peer_hint,
                    source: "tailscale".to_string(),
                    device_name: candidate.device_name,
                    platform: candidate.platform,
                },
            );
        }
    }
}

fn should_emit_candidate(
    last_candidate: &Option<(String, Instant)>,
    key: &str,
    now: Instant,
) -> bool {
    match last_candidate {
        Some((last_key, last_seen)) if last_key == key => {
            now.duration_since(*last_seen) >= REEMIT_AFTER
        }
        _ => true,
    }
}

fn read_tailscale_status() -> Result<TailscaleStatus, String> {
    let mut last_error = String::new();

    for command in tailscale_command_candidates() {
        let mut cmd = Command::new(command);
        cmd.args(["status", "--json"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let output = match cmd.output() {
            Ok(output) => output,
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        };

        if !output.status.success() {
            last_error = String::from_utf8_lossy(&output.stderr).to_string();
            continue;
        }

        return serde_json::from_slice(&output.stdout).map_err(|error| error.to_string());
    }

    Err(last_error)
}

fn tailscale_command_candidates() -> Vec<&'static str> {
    let mut candidates = vec!["tailscale"];

    #[cfg(target_os = "macos")]
    {
        candidates.extend([
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]);
    }

    #[cfg(target_os = "windows")]
    {
        candidates.extend([
            r"C:\Program Files\Tailscale\tailscale.exe",
            r"C:\Program Files (x86)\Tailscale\tailscale.exe",
        ]);
    }

    #[cfg(target_os = "linux")]
    {
        candidates.extend(["/usr/bin/tailscale", "/usr/local/bin/tailscale"]);
    }

    candidates
}

fn select_candidates(status: &TailscaleStatus) -> Vec<TailscaleCandidate> {
    let self_id = status.self_node.id.trim();
    let Some(self_ip) = first_tailscale_ip(&status.self_node) else {
        return Vec::new();
    };
    if self_id.is_empty() {
        return Vec::new();
    }

    let mut peers = status
        .peer
        .values()
        .filter(|peer| peer.online)
        .filter_map(|peer| {
            let peer_id = peer.id.trim();
            let peer_ip = first_tailscale_ip(peer)?;
            if peer_id.is_empty() {
                return None;
            }
            Some((
                peer_id.to_string(),
                peer_ip.to_string(),
                peer_hint(peer),
                device_name_from_dns(peer),
                platform_from_tailscale_os(peer),
            ))
        })
        .collect::<Vec<_>>();
    peers.sort_by(|left, right| left.0.cmp(&right.0));

    peers
        .into_iter()
        .map(|(peer_id, peer_ip, peer_hint, device_name, platform)| {
            let server_ip = if self_id <= peer_id.as_str() {
                self_ip
            } else {
                peer_ip.as_str()
            };
            let mode = if server_ip == self_ip { "host" } else { "join" };

            TailscaleCandidate {
                signaling_url: format!("ws://{server_ip}:{SIGNALING_PORT}"),
                room_id: room_id_for_pair(self_id, &peer_id),
                mode: mode.to_string(),
                peer_hint,
                probe_host: peer_ip,
                device_name,
                platform,
            }
        })
        .collect()
}

fn first_tailscale_ip(node: &TailscaleNode) -> Option<&str> {
    node.tailscale_ips
        .iter()
        .find(|ip| ip.starts_with("100.") || ip.contains(':'))
        .map(String::as_str)
}

fn peer_hint(node: &TailscaleNode) -> String {
    let dns_name = node.dns_name.trim().trim_end_matches('.');
    if !dns_name.is_empty() {
        return dns_name.to_string();
    }
    first_tailscale_ip(node)
        .unwrap_or("Tailscale peer")
        .to_string()
}

fn device_name_from_dns(node: &TailscaleNode) -> Option<String> {
    node.dns_name
        .split('.')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn platform_from_tailscale_os(node: &TailscaleNode) -> Option<String> {
    let os = node.os.trim();
    if os.is_empty() {
        None
    } else if os.eq_ignore_ascii_case("macOS") {
        Some("macos".to_string())
    } else {
        Some(os.to_ascii_lowercase())
    }
}

fn is_kunochat_reachable(peer_hint: &str) -> bool {
    let Ok(addresses) = (peer_hint, SIGNALING_PORT).to_socket_addrs() else {
        return false;
    };
    addresses.into_iter().any(|address: SocketAddr| {
        TcpStream::connect_timeout(&address, Duration::from_millis(450)).is_ok()
    })
}

fn room_id_for_pair(left: &str, right: &str) -> String {
    let (first, second) = if left <= right {
        (left, right)
    } else {
        (right, left)
    };
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

    fn node(id: &str, ip: &str, dns_name: &str, online: bool) -> TailscaleNode {
        TailscaleNode {
            id: id.to_string(),
            dns_name: dns_name.to_string(),
            tailscale_ips: vec![ip.to_string()],
            os: String::new(),
            online,
        }
    }

    #[test]
    fn selects_no_candidate_without_online_peers() {
        let status = TailscaleStatus {
            self_node: node("self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer: HashMap::new(),
        };
        assert!(select_candidates(&status).is_empty());
    }

    #[test]
    fn selects_online_peer() {
        let mut peer = HashMap::new();
        peer.insert(
            "peer".to_string(),
            node("peer", "100.64.0.2", "peer.tailnet.ts.net.", true),
        );
        let status = TailscaleStatus {
            self_node: node("self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer,
        };
        let candidate = select_candidates(&status).into_iter().next().expect("candidate");
        assert_eq!(candidate.peer_hint, "peer.tailnet.ts.net");
        assert_eq!(candidate.room_id.len(), 6);
    }

    #[test]
    fn ignores_offline_peer() {
        let mut peer = HashMap::new();
        peer.insert(
            "peer".to_string(),
            node("peer", "100.64.0.2", "peer.tailnet.ts.net.", false),
        );
        let status = TailscaleStatus {
            self_node: node("self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer,
        };
        assert!(select_candidates(&status).is_empty());
    }

    #[test]
    fn lower_id_hosts() {
        let mut peer = HashMap::new();
        peer.insert(
            "peer".to_string(),
            node("z-peer", "100.64.0.2", "peer.tailnet.ts.net.", true),
        );
        let status = TailscaleStatus {
            self_node: node("a-self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer,
        };
        let candidate = select_candidates(&status).into_iter().next().expect("candidate");
        assert_eq!(candidate.mode, "host");
        assert_eq!(candidate.signaling_url, "ws://100.64.0.1:8787");
    }

    #[test]
    fn higher_id_joins() {
        let mut peer = HashMap::new();
        peer.insert(
            "peer".to_string(),
            node("a-peer", "100.64.0.2", "peer.tailnet.ts.net.", true),
        );
        let status = TailscaleStatus {
            self_node: node("z-self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer,
        };
        let candidate = select_candidates(&status).into_iter().next().expect("candidate");
        assert_eq!(candidate.mode, "join");
        assert_eq!(candidate.signaling_url, "ws://100.64.0.2:8787");
    }

    #[test]
    fn selects_all_online_peers() {
        let mut peer = HashMap::new();
        peer.insert(
            "first".to_string(),
            node("b-peer", "100.64.0.2", "first.tailnet.ts.net.", true),
        );
        peer.insert(
            "second".to_string(),
            node("c-peer", "100.64.0.3", "second.tailnet.ts.net.", true),
        );
        let status = TailscaleStatus {
            self_node: node("a-self", "100.64.0.1", "self.tailnet.ts.net.", true),
            peer,
        };

        let candidates = select_candidates(&status);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].peer_hint, "first.tailnet.ts.net");
        assert_eq!(candidates[1].peer_hint, "second.tailnet.ts.net");
    }

    #[test]
    fn room_id_is_symmetric() {
        assert_eq!(room_id_for_pair("a", "b"), room_id_for_pair("b", "a"));
    }

    #[test]
    fn parses_tailscale_status_json_shape() {
        let status: TailscaleStatus = serde_json::from_str(
            r#"{
              "Self": {
                "ID": "self-id",
                "DNSName": "self.tailnet.ts.net.",
                "TailscaleIPs": ["100.64.0.1"],
                "Online": true
              },
              "Peer": {
                "nodekey:peer": {
                  "ID": "peer-id",
                  "DNSName": "peer.tailnet.ts.net.",
                  "TailscaleIPs": ["100.64.0.2"],
                  "Online": true
                }
              }
            }"#,
        )
        .expect("status json should parse");

        assert_eq!(status.self_node.id, "self-id");
        assert_eq!(
            status.peer.values().next().expect("peer").tailscale_ips[0],
            "100.64.0.2"
        );
    }

    #[test]
    fn command_candidates_include_plain_tailscale() {
        assert!(tailscale_command_candidates().contains(&"tailscale"));
    }

    #[test]
    fn should_emit_new_candidate_immediately() {
        let now = Instant::now();
        let last_candidate = Some(("old".to_string(), now));
        assert!(should_emit_candidate(&last_candidate, "new", now));
    }

    #[test]
    fn should_suppress_same_candidate_until_reemit_window() {
        let now = Instant::now();
        let last_candidate = Some(("same".to_string(), now));
        assert!(!should_emit_candidate(
            &last_candidate,
            "same",
            now + Duration::from_secs(2)
        ));
    }

    #[test]
    fn should_reemit_same_candidate_after_reemit_window() {
        let now = Instant::now();
        let last_candidate = Some(("same".to_string(), now));
        assert!(should_emit_candidate(
            &last_candidate,
            "same",
            now + REEMIT_AFTER
        ));
    }
}
