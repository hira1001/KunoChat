import { invoke } from "@tauri-apps/api/core";

export type ListenerStatus = {
  tcpSignaling: boolean;
  udpDiscovery: boolean;
  tcpTransfer: boolean;
};

export type FirewallRuleInfo = {
  displayName: string;
  enabled: string;
  direction: string;
  action: string;
  program?: string | null;
};

export type FirewallStatus = "ok" | "blocked" | "stale" | "missing" | "unknown";

export type FirewallReport = {
  supported: boolean;
  status: FirewallStatus;
  rules: FirewallRuleInfo[];
  detail?: string | null;
};

export type TailscalePeerInfo = {
  deviceName?: string | null;
  ip?: string | null;
  online: boolean;
  kunochatReachable?: boolean | null;
};

export type TailscaleReport = {
  available: boolean;
  selfIp?: string | null;
  peers: TailscalePeerInfo[];
  error?: string | null;
};

export type NetworkDiagnostics = {
  appVersion: string;
  exePath?: string | null;
  platform: string;
  lanIp?: string | null;
  tailscaleIp?: string | null;
  listeners: ListenerStatus;
  firewall: FirewallReport;
  tailscale: TailscaleReport;
  generatedAtMs: number;
};

export type PeerPortProbe = {
  host: string;
  signalingReachable: boolean;
  transferReachable: boolean;
  signalingLatencyMs?: number | null;
};

export type ConnectionContext = {
  lastCandidate?: {
    deviceName?: string;
    peerHint: string;
    source?: string;
    signalingUrl: string;
    reachable?: boolean;
  };
  lastFailure?: {
    reason: string;
    at: number;
  };
};

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function diagnosticsSupported(): boolean {
  return hasTauri;
}

export async function collectNetworkDiagnostics(): Promise<NetworkDiagnostics> {
  if (!hasTauri) {
    throw new Error("ネットワーク診断はデスクトップアプリでのみ利用できます。");
  }
  return invoke<NetworkDiagnostics>("collect_network_diagnostics");
}

export async function probePeerPorts(host: string): Promise<PeerPortProbe> {
  if (!hasTauri) {
    throw new Error("ピア診断はデスクトップアプリでのみ利用できます。");
  }
  return invoke<PeerPortProbe>("probe_peer_ports", { host });
}

export async function repairFirewallRules(): Promise<void> {
  if (!hasTauri) {
    throw new Error("ファイアウォール修復はデスクトップアプリでのみ利用できます。");
  }
  await invoke<void>("repair_firewall_rules");
}

/**
 * The same repair the in-app one-click button runs, as a copyable PowerShell
 * command for repairing a *remote* machine (or when elevation was declined).
 */
export function firewallRepairCommand(exePath?: string | null): string {
  const exeLine = exePath
    ? `$exe = '${exePath.replace(/'/g, "''")}'`
    : `$exe = Join-Path $env:LOCALAPPDATA 'KunoChat\\kunochat.exe'`;
  return [
    exeLine,
    `Get-NetFirewallRule -DisplayName 'KunoChat*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    `New-NetFirewallRule -DisplayName 'KunoChat TCP 8787' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Program $exe -Profile Any`,
    `New-NetFirewallRule -DisplayName 'KunoChat TCP 8790' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Program $exe -Profile Any`,
    `New-NetFirewallRule -DisplayName 'KunoChat UDP 8788' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8788 -Program $exe -Profile Any`
  ].join("\n");
}

export function firewallStatusLabel(report: FirewallReport): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (!report.supported) {
    return { label: "このOSでは確認できません", tone: "muted" };
  }
  switch (report.status) {
    case "ok":
      return { label: "許可済み(現在のアプリを許可)", tone: "ok" };
    case "blocked":
      return { label: "ブロック中(受信がブロックされています)", tone: "danger" };
    case "stale":
      return { label: "古いルール(現在のアプリと不一致)", tone: "warn" };
    case "missing":
      return { label: "ルールなし(受信許可が未設定)", tone: "warn" };
    default:
      return { label: "確認できませんでした", tone: "muted" };
  }
}

export function firewallNeedsRepair(report: FirewallReport): boolean {
  return report.supported && (report.status === "blocked" || report.status === "stale" || report.status === "missing");
}

/**
 * Human-readable, copyable diagnostic report. Pure so it can be unit tested.
 */
export function buildDiagnosticReport(
  diagnostics: NetworkDiagnostics,
  context: ConnectionContext = {},
  now: Date = new Date(diagnostics.generatedAtMs)
): string {
  const lines: string[] = [];
  const yes = (value: boolean | null | undefined) => (value === true ? "OK" : value === false ? "NG" : "不明");
  lines.push("# KunoChat ネットワーク診断レポート");
  lines.push(`日時: ${now.toISOString()}`);
  lines.push(`バージョン: ${diagnostics.appVersion}`);
  lines.push(`実行ファイル: ${diagnostics.exePath ?? "不明"}`);
  lines.push(`プラットフォーム: ${diagnostics.platform}`);
  lines.push("");
  lines.push("## このPC");
  lines.push(`LAN IP: ${diagnostics.lanIp ?? "不明"}`);
  lines.push(`Tailscale IP: ${diagnostics.tailscaleIp ?? "なし"}`);
  lines.push(`TCP 8787 (シグナリング待受): ${yes(diagnostics.listeners.tcpSignaling)}`);
  lines.push(`UDP 8788 (LAN探索待受): ${yes(diagnostics.listeners.udpDiscovery)}`);
  lines.push(`TCP 8790 (ファイル転送待受): ${yes(diagnostics.listeners.tcpTransfer)}`);
  lines.push("");
  lines.push("## Windowsファイアウォール");
  if (!diagnostics.firewall.supported) {
    lines.push("このOSでは確認できません。");
  } else {
    lines.push(`状態: ${diagnostics.firewall.status}`);
    for (const rule of diagnostics.firewall.rules) {
      lines.push(
        `- ${rule.displayName} | ${rule.direction} | ${rule.action} | enabled=${rule.enabled} | ${rule.program ?? "(program不明)"}`
      );
    }
    if (diagnostics.firewall.detail) {
      lines.push(`詳細: ${diagnostics.firewall.detail}`);
    }
  }
  lines.push("");
  lines.push("## Tailscale");
  if (!diagnostics.tailscale.available) {
    lines.push(`利用不可${diagnostics.tailscale.error ? `: ${diagnostics.tailscale.error}` : ""}`);
  } else {
    lines.push(`自分のIP: ${diagnostics.tailscale.selfIp ?? "不明"}`);
    for (const peer of diagnostics.tailscale.peers) {
      const reach =
        peer.kunochatReachable === true
          ? "KunoChat応答あり"
          : peer.kunochatReachable === false
            ? "KunoChat応答なし(8787閉)"
            : "未確認";
      lines.push(`- ${peer.deviceName ?? peer.ip ?? "不明"} (${peer.ip ?? "IP不明"}): ${peer.online ? "オンライン" : "オフライン"} / ${reach}`);
    }
    if (diagnostics.tailscale.peers.length === 0) {
      lines.push("- ピアなし");
    }
  }
  lines.push("");
  lines.push("## 接続状況");
  if (context.lastCandidate) {
    const candidate = context.lastCandidate;
    lines.push(
      `最後の接続候補: ${candidate.deviceName ?? candidate.peerHint} (${candidate.peerHint}, ${candidate.source ?? "不明"}, ${candidate.signalingUrl}${
        candidate.reachable === false ? ", KunoChat応答なし" : ""
      })`
    );
  } else {
    lines.push("最後の接続候補: なし");
  }
  if (context.lastFailure) {
    lines.push(`最後の接続失敗: ${context.lastFailure.reason} (${new Date(context.lastFailure.at).toISOString()})`);
  } else {
    lines.push("最後の接続失敗: なし");
  }
  return lines.join("\n");
}

/**
 * Honest per-peer reachability summary used by the pairing screen and the
 * connection banner. "Device online" and "KunoChat reachable" are different
 * facts and must be labeled separately.
 */
export function peerReachabilitySummary(peer: {
  deviceName?: string;
  peerHint: string;
  source?: string;
  reachable?: boolean;
}): { label: string; guidance?: string; tone: "ok" | "warn" } {
  const name = peer.deviceName || peer.peerHint;
  if (peer.reachable === false) {
    return {
      label: "端末はオンライン / KunoChat応答なし",
      guidance: `${name} は${peer.source === "tailscale" ? "Tailscale" : "ネットワーク"}上でオンラインですが、KunoChat(ポート8787)が応答していません。${name} 側でKunoChatを起動・更新するか、設定のネットワーク診断からファイアウォールを修復してください。`,
      tone: "warn"
    };
  }
  return { label: "接続可能", tone: "ok" };
}
