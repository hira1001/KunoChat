import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  firewallNeedsRepair,
  firewallRepairCommand,
  firewallStatusLabel,
  peerReachabilitySummary,
  type FirewallReport,
  type NetworkDiagnostics
} from "./diagnosticsService";

function sampleDiagnostics(overrides: Partial<NetworkDiagnostics> = {}): NetworkDiagnostics {
  return {
    appVersion: "0.7.0",
    exePath: "C:\\Users\\test\\AppData\\Local\\KunoChat\\kunochat.exe",
    platform: "windows",
    lanIp: "192.168.64.79",
    tailscaleIp: "100.87.112.32",
    listeners: { tcpSignaling: true, udpDiscovery: true, tcpTransfer: true },
    firewall: {
      supported: true,
      status: "ok",
      rules: [
        {
          displayName: "KunoChat TCP 8787",
          enabled: "True",
          direction: "Inbound",
          action: "Allow",
          program: "C:\\Users\\test\\AppData\\Local\\KunoChat\\kunochat.exe"
        }
      ]
    },
    tailscale: {
      available: true,
      selfIp: "100.87.112.32",
      peers: [
        { deviceName: "HomeDesktop", ip: "100.100.123.107", online: true, kunochatReachable: false }
      ]
    },
    generatedAtMs: 1_750_000_000_000,
    ...overrides
  };
}

describe("firewallRepairCommand", () => {
  it("uses the provided executable path", () => {
    const command = firewallRepairCommand("C:\\Apps\\KunoChat\\kunochat.exe");
    expect(command).toContain("$exe = 'C:\\Apps\\KunoChat\\kunochat.exe'");
  });

  it("escapes single quotes in the path", () => {
    const command = firewallRepairCommand("C:\\User's\\kunochat.exe");
    expect(command).toContain("C:\\User''s\\kunochat.exe");
  });

  it("falls back to the default install path", () => {
    const command = firewallRepairCommand(undefined);
    expect(command).toContain("Join-Path $env:LOCALAPPDATA 'KunoChat\\kunochat.exe'");
  });

  it("recreates rules for all three KunoChat ports", () => {
    const command = firewallRepairCommand("C:\\Apps\\kunochat.exe");
    expect(command).toContain("KunoChat TCP 8787");
    expect(command).toContain("KunoChat TCP 8790");
    expect(command).toContain("KunoChat UDP 8788");
    expect(command).toContain("Remove-NetFirewallRule");
  });
});

describe("firewallStatusLabel / firewallNeedsRepair", () => {
  const report = (status: FirewallReport["status"], supported = true): FirewallReport => ({
    supported,
    status,
    rules: []
  });

  it("treats ok as healthy", () => {
    expect(firewallStatusLabel(report("ok")).tone).toBe("ok");
    expect(firewallNeedsRepair(report("ok"))).toBe(false);
  });

  it("flags blocked as danger and repairable", () => {
    expect(firewallStatusLabel(report("blocked")).tone).toBe("danger");
    expect(firewallNeedsRepair(report("blocked"))).toBe(true);
  });

  it("flags stale and missing as repairable warnings", () => {
    expect(firewallStatusLabel(report("stale")).tone).toBe("warn");
    expect(firewallNeedsRepair(report("stale"))).toBe(true);
    expect(firewallStatusLabel(report("missing")).tone).toBe("warn");
    expect(firewallNeedsRepair(report("missing"))).toBe(true);
  });

  it("never suggests repair on unsupported platforms", () => {
    expect(firewallNeedsRepair(report("missing", false))).toBe(false);
  });
});

describe("buildDiagnosticReport", () => {
  it("includes version, listeners, firewall, tailscale, and connection context", () => {
    const reportText = buildDiagnosticReport(sampleDiagnostics(), {
      lastCandidate: {
        deviceName: "HomeDesktop",
        peerHint: "100.100.123.107",
        source: "tailscale",
        signalingUrl: "ws://100.87.112.32:8787",
        reachable: false
      },
      lastFailure: { reason: "接続が時間切れになりました。", at: 1_750_000_100_000 }
    });

    expect(reportText).toContain("バージョン: 0.7.0");
    expect(reportText).toContain("TCP 8787 (シグナリング待受): OK");
    expect(reportText).toContain("UDP 8788 (LAN探索待受): OK");
    expect(reportText).toContain("TCP 8790 (ファイル転送待受): OK");
    expect(reportText).toContain("KunoChat TCP 8787 | Inbound | Allow");
    expect(reportText).toContain("HomeDesktop (100.100.123.107): オンライン / KunoChat応答なし(8787閉)");
    expect(reportText).toContain("最後の接続候補: HomeDesktop (100.100.123.107, tailscale, ws://100.87.112.32:8787, KunoChat応答なし)");
    expect(reportText).toContain("最後の接続失敗: 接続が時間切れになりました。");
  });

  it("marks a dead listener as NG", () => {
    const reportText = buildDiagnosticReport(
      sampleDiagnostics({
        listeners: { tcpSignaling: false, udpDiscovery: true, tcpTransfer: true }
      })
    );
    expect(reportText).toContain("TCP 8787 (シグナリング待受): NG");
  });

  it("reports missing tailscale and empty context gracefully", () => {
    const reportText = buildDiagnosticReport(
      sampleDiagnostics({
        tailscale: { available: false, peers: [], error: "not found" }
      })
    );
    expect(reportText).toContain("利用不可: not found");
    expect(reportText).toContain("最後の接続候補: なし");
    expect(reportText).toContain("最後の接続失敗: なし");
  });
});

describe("peerReachabilitySummary", () => {
  it("labels an unreachable tailscale peer honestly with guidance", () => {
    const summary = peerReachabilitySummary({
      deviceName: "HomeDesktop",
      peerHint: "100.100.123.107",
      source: "tailscale",
      reachable: false
    });
    expect(summary.tone).toBe("warn");
    expect(summary.label).toContain("端末はオンライン");
    expect(summary.label).toContain("KunoChat応答なし");
    expect(summary.guidance).toContain("HomeDesktop");
    expect(summary.guidance).toContain("8787");
    expect(summary.guidance).toContain("ファイアウォール");
  });

  it("treats reachable and unknown reachability as connectable", () => {
    expect(peerReachabilitySummary({ peerHint: "192.168.64.51", reachable: true }).tone).toBe("ok");
    expect(peerReachabilitySummary({ peerHint: "192.168.64.51" }).tone).toBe("ok");
  });
});
