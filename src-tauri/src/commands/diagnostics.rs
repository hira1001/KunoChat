use serde::{Deserialize, Serialize};
use std::{
    net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const SIGNALING_PORT: u16 = 8787;
const DISCOVERY_PORT: u16 = 8788;
const TRANSFER_PORT: u16 = 8790;
const LOCAL_PROBE_TIMEOUT: Duration = Duration::from_millis(600);
const PEER_PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
const TAILSCALE_PEER_PROBE_TIMEOUT: Duration = Duration::from_millis(450);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerStatus {
    tcp_signaling: bool,
    udp_discovery: bool,
    tcp_transfer: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRuleInfo {
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub enabled: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub program: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallReport {
    supported: bool,
    /// "ok" | "blocked" | "stale" | "missing" | "unknown"
    status: String,
    rules: Vec<FirewallRuleInfo>,
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscalePeerInfo {
    device_name: Option<String>,
    ip: Option<String>,
    online: bool,
    kunochat_reachable: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleReport {
    available: bool,
    self_ip: Option<String>,
    peers: Vec<TailscalePeerInfo>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDiagnostics {
    app_version: String,
    exe_path: Option<String>,
    platform: String,
    lan_ip: Option<String>,
    tailscale_ip: Option<String>,
    listeners: ListenerStatus,
    firewall: FirewallReport,
    tailscale: TailscaleReport,
    generated_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPortProbe {
    host: String,
    signaling_reachable: bool,
    transfer_reachable: bool,
    signaling_latency_ms: Option<u64>,
}

#[tauri::command]
pub async fn collect_network_diagnostics(app: AppHandle) -> Result<NetworkDiagnostics, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || collect_blocking(version))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn probe_peer_ports(host: String) -> Result<PeerPortProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let signaling_reachable = tcp_port_reachable(&host, SIGNALING_PORT, PEER_PROBE_TIMEOUT);
        let signaling_latency_ms = signaling_reachable.then(|| started.elapsed().as_millis() as u64);
        let transfer_reachable = tcp_port_reachable(&host, TRANSFER_PORT, PEER_PROBE_TIMEOUT);
        PeerPortProbe {
            host,
            signaling_reachable,
            transfer_reachable,
            signaling_latency_ms,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn repair_firewall_rules() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return tauri::async_runtime::spawn_blocking(launch_firewall_repair_windows)
            .await
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Firewall repair is only supported on Windows.".to_string())
    }
}

fn collect_blocking(app_version: String) -> NetworkDiagnostics {
    let exe_path = std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string());

    let listeners = ListenerStatus {
        tcp_signaling: tcp_port_reachable("127.0.0.1", SIGNALING_PORT, LOCAL_PROBE_TIMEOUT),
        udp_discovery: udp_port_in_use(DISCOVERY_PORT),
        tcp_transfer: tcp_port_reachable("127.0.0.1", TRANSFER_PORT, LOCAL_PROBE_TIMEOUT),
    };

    let tailscale = collect_tailscale_report();
    let lan_ip = default_route_local_ip();
    let tailscale_ip = tailscale
        .self_ip
        .clone()
        .or_else(tailscale_interface_local_ip);

    let firewall = collect_firewall_report(exe_path.as_deref());

    NetworkDiagnostics {
        app_version,
        exe_path,
        platform: platform_name().to_string(),
        lan_ip,
        tailscale_ip,
        listeners,
        firewall,
        tailscale,
        generated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default(),
    }
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "linux"
    }
}

fn tcp_port_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    let Ok(addresses) = (host, port).to_socket_addrs() else {
        return false;
    };
    addresses
        .into_iter()
        .any(|address: SocketAddr| TcpStream::connect_timeout(&address, timeout).is_ok())
}

/// The discovery socket binds 0.0.0.0:8788 without address reuse, so a failed
/// second bind means our own listener already holds the port.
fn udp_port_in_use(port: u16) -> bool {
    UdpSocket::bind(("0.0.0.0", port)).is_err()
}

fn default_route_local_ip() -> Option<String> {
    udp_connect_local_ip("8.8.8.8:80")
}

fn tailscale_interface_local_ip() -> Option<String> {
    // 100.100.100.100 is the Tailscale MagicDNS resolver; routing to it reveals
    // the local Tailscale interface address when Tailscale is up.
    udp_connect_local_ip("100.100.100.100:53").filter(|ip| ip.starts_with("100."))
}

fn udp_connect_local_ip(target: &str) -> Option<String> {
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(target).ok()?;
    socket
        .local_addr()
        .ok()
        .map(|address| address.ip().to_string())
}

fn collect_tailscale_report() -> TailscaleReport {
    match crate::native::tailscale_discovery::read_tailscale_status() {
        Ok(status) => {
            let self_ip = status
                .self_node
                .tailscale_ips
                .iter()
                .find(|ip| ip.starts_with("100."))
                .cloned();
            let mut peers = status
                .peer
                .values()
                .map(|peer| {
                    let ip = peer
                        .tailscale_ips
                        .iter()
                        .find(|ip| ip.starts_with("100."))
                        .cloned();
                    let kunochat_reachable = if peer.online {
                        ip.as_deref().map(|host| {
                            tcp_port_reachable(host, SIGNALING_PORT, TAILSCALE_PEER_PROBE_TIMEOUT)
                        })
                    } else {
                        None
                    };
                    TailscalePeerInfo {
                        device_name: short_dns_name(&peer.dns_name),
                        ip,
                        online: peer.online,
                        kunochat_reachable,
                    }
                })
                .collect::<Vec<_>>();
            peers.sort_by(|left, right| {
                right
                    .online
                    .cmp(&left.online)
                    .then_with(|| left.device_name.cmp(&right.device_name))
            });
            TailscaleReport {
                available: true,
                self_ip,
                peers,
                error: None,
            }
        }
        Err(error) => TailscaleReport {
            available: false,
            self_ip: None,
            peers: Vec::new(),
            error: if error.is_empty() { None } else { Some(error) },
        },
    }
}

fn short_dns_name(dns_name: &str) -> Option<String> {
    dns_name
        .split('.')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn collect_firewall_report(exe_path: Option<&str>) -> FirewallReport {
    #[cfg(target_os = "windows")]
    {
        return collect_firewall_report_windows(exe_path);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = exe_path;
        FirewallReport {
            supported: false,
            status: "unknown".to_string(),
            rules: Vec::new(),
            detail: Some("Firewall inspection is only implemented on Windows.".to_string()),
        }
    }
}

#[cfg(target_os = "windows")]
fn collect_firewall_report_windows(exe_path: Option<&str>) -> FirewallReport {
    const QUERY: &str = r#"
$items = @()
$filters = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like '*kunochat*' }
foreach ($filter in $filters) {
  $rule = $filter | Get-NetFirewallRule -ErrorAction SilentlyContinue
  if ($rule) {
    $items += [pscustomobject]@{
      displayName = [string]$rule.DisplayName
      enabled = [string]$rule.Enabled
      direction = [string]$rule.Direction
      action = [string]$rule.Action
      program = [string]$filter.Program
    }
  }
}
$named = Get-NetFirewallRule -DisplayName 'KunoChat*' -ErrorAction SilentlyContinue
foreach ($rule in $named) {
  $filter = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
  $items += [pscustomobject]@{
    displayName = [string]$rule.DisplayName
    enabled = [string]$rule.Enabled
    direction = [string]$rule.Direction
    action = [string]$rule.Action
    program = [string]$filter.Program
  }
}
ConvertTo-Json -InputObject @($items | Sort-Object displayName, program -Unique) -Compress
"#;

    match run_powershell(QUERY) {
        Ok(stdout) => match parse_firewall_rules(&stdout) {
            Ok(rules) => {
                let status = classify_firewall_rules(&rules, exe_path).to_string();
                FirewallReport {
                    supported: true,
                    status,
                    rules,
                    detail: None,
                }
            }
            Err(error) => FirewallReport {
                supported: true,
                status: "unknown".to_string(),
                rules: Vec::new(),
                detail: Some(format!("Failed to parse firewall rules: {error}")),
            },
        },
        Err(error) => FirewallReport {
            supported: true,
            status: "unknown".to_string(),
            rules: Vec::new(),
            detail: Some(format!("Failed to query firewall rules: {error}")),
        },
    }
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_firewall_rules(stdout: &str) -> Result<Vec<FirewallRuleInfo>, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<FirewallRuleInfo>>(trimmed).map_err(|error| error.to_string())
    } else {
        serde_json::from_str::<FirewallRuleInfo>(trimmed)
            .map(|rule| vec![rule])
            .map_err(|error| error.to_string())
    }
}

fn rule_is_enabled(rule: &FirewallRuleInfo) -> bool {
    rule.enabled.eq_ignore_ascii_case("true") || rule.enabled == "1"
}

fn rule_matches_program(rule: &FirewallRuleInfo, exe_path: &str) -> bool {
    rule.program
        .as_deref()
        .map(|program| {
            program.replace('/', "\\").trim().to_ascii_lowercase()
                == exe_path.replace('/', "\\").trim().to_ascii_lowercase()
        })
        .unwrap_or(false)
}

/// Classify KunoChat firewall rules for the active executable:
/// - "blocked": an enabled inbound Block rule targets the current exe.
/// - "ok": an enabled inbound Allow rule targets the current exe.
/// - "stale": inbound rules exist, but none of them targets the current exe.
/// - "missing": no KunoChat inbound rules at all.
fn classify_firewall_rules(rules: &[FirewallRuleInfo], exe_path: Option<&str>) -> &'static str {
    let inbound = rules
        .iter()
        .filter(|rule| rule.direction.eq_ignore_ascii_case("inbound"))
        .collect::<Vec<_>>();
    if inbound.is_empty() {
        return "missing";
    }
    let Some(exe_path) = exe_path else {
        return "unknown";
    };

    let blocked = inbound.iter().any(|rule| {
        rule_is_enabled(rule)
            && rule.action.eq_ignore_ascii_case("block")
            && rule_matches_program(rule, exe_path)
    });
    if blocked {
        return "blocked";
    }
    let allowed = inbound.iter().any(|rule| {
        rule_is_enabled(rule)
            && rule.action.eq_ignore_ascii_case("allow")
            && rule_matches_program(rule, exe_path)
    });
    if allowed {
        return "ok";
    }
    "stale"
}

/// PowerShell script that removes every KunoChat firewall rule (including
/// stale/block rules from old install paths) and re-creates inbound allow
/// rules for the currently running executable.
pub fn firewall_repair_script(exe_path: &str) -> String {
    let escaped = exe_path.replace('\'', "''");
    format!(
        r#"$exe = '{escaped}'
Get-NetFirewallRule -DisplayName 'KunoChat*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object {{ $_.Program -like '*kunochat*' }} | Get-NetFirewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'KunoChat TCP 8787' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Program $exe -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'KunoChat TCP 8790' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Program $exe -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'KunoChat UDP 8788' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8788 -Program $exe -Profile Any | Out-Null
"#
    )
}

#[cfg(target_os = "windows")]
fn launch_firewall_repair_windows() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let exe_path = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string();
    let script = firewall_repair_script(&exe_path);
    let script_path = std::env::temp_dir().join("kunochat-firewall-repair.ps1");
    std::fs::write(&script_path, script).map_err(|error| error.to_string())?;

    let script_arg = script_path.to_string_lossy().replace('\'', "''");
    let launcher = format!(
        "Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{script_arg}'"
    );
    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &launcher])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(
            "管理者権限の確認がキャンセルされたため、ファイアウォールを修復できませんでした。".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(
        display_name: &str,
        enabled: &str,
        direction: &str,
        action: &str,
        program: Option<&str>,
    ) -> FirewallRuleInfo {
        FirewallRuleInfo {
            display_name: display_name.to_string(),
            enabled: enabled.to_string(),
            direction: direction.to_string(),
            action: action.to_string(),
            program: program.map(ToString::to_string),
        }
    }

    const EXE: &str = r"C:\Users\test\AppData\Local\KunoChat\kunochat.exe";

    #[test]
    fn classifies_missing_when_no_rules() {
        assert_eq!(classify_firewall_rules(&[], Some(EXE)), "missing");
    }

    #[test]
    fn classifies_missing_when_only_outbound_rules() {
        let rules = vec![rule("KunoChat", "True", "Outbound", "Allow", Some(EXE))];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "missing");
    }

    #[test]
    fn classifies_ok_for_enabled_inbound_allow_on_current_exe() {
        let rules = vec![rule(
            "KunoChat TCP 8787",
            "True",
            "Inbound",
            "Allow",
            Some(EXE),
        )];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "ok");
    }

    #[test]
    fn classifies_ok_case_insensitively_on_program_path() {
        let rules = vec![rule(
            "KunoChat TCP 8787",
            "True",
            "Inbound",
            "Allow",
            Some(r"c:\users\test\appdata\local\kunochat\KUNOCHAT.EXE"),
        )];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "ok");
    }

    #[test]
    fn classifies_blocked_when_inbound_block_rule_targets_exe() {
        let rules = vec![
            rule("kunochat.exe", "True", "Inbound", "Block", Some(EXE)),
            rule("KunoChat TCP 8787", "True", "Inbound", "Allow", Some(EXE)),
        ];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "blocked");
    }

    #[test]
    fn classifies_stale_when_rules_point_to_old_path() {
        let rules = vec![rule(
            "KunoChat TCP 8787",
            "True",
            "Inbound",
            "Allow",
            Some(r"C:\OldInstall\kunochat.exe"),
        )];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "stale");
    }

    #[test]
    fn classifies_stale_when_matching_rule_is_disabled() {
        let rules = vec![rule(
            "KunoChat TCP 8787",
            "False",
            "Inbound",
            "Allow",
            Some(EXE),
        )];
        assert_eq!(classify_firewall_rules(&rules, Some(EXE)), "stale");
    }

    #[test]
    fn parses_firewall_rule_array_json() {
        let rules = parse_firewall_rules(
            r#"[{"displayName":"KunoChat TCP 8787","enabled":"True","direction":"Inbound","action":"Allow","program":"C:\\app\\kunochat.exe"}]"#,
        )
        .expect("rules should parse");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].display_name, "KunoChat TCP 8787");
        assert!(rule_is_enabled(&rules[0]));
    }

    #[test]
    fn parses_single_firewall_rule_object_json() {
        let rules = parse_firewall_rules(
            r#"{"displayName":"kunochat.exe","enabled":"True","direction":"Inbound","action":"Block","program":null}"#,
        )
        .expect("rule should parse");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].action, "Block");
        assert!(rules[0].program.is_none());
    }

    #[test]
    fn parses_empty_output_as_no_rules() {
        assert!(parse_firewall_rules("  \n").expect("empty ok").is_empty());
        assert!(parse_firewall_rules("[]").expect("empty array ok").is_empty());
    }

    #[test]
    fn repair_script_targets_all_three_ports() {
        let script = firewall_repair_script(EXE);
        assert!(script.contains("KunoChat TCP 8787"));
        assert!(script.contains("KunoChat TCP 8790"));
        assert!(script.contains("KunoChat UDP 8788"));
        assert!(script.contains(EXE));
        assert!(script.contains("Remove-NetFirewallRule"));
    }

    #[test]
    fn repair_script_escapes_single_quotes_in_path() {
        let script = firewall_repair_script(r"C:\User's\kunochat.exe");
        assert!(script.contains(r"C:\User''s\kunochat.exe"));
    }
}
