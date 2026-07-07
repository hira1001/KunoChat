import {
  Activity,
  Check,
  ChevronLeft,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildDiagnosticReport,
  collectNetworkDiagnostics,
  diagnosticsSupported,
  firewallNeedsRepair,
  firewallRepairCommand,
  firewallStatusLabel,
  probePeerPorts,
  repairFirewallRules,
  type ConnectionContext,
  type NetworkDiagnostics,
  type PeerPortProbe
} from "../features/diagnostics/diagnosticsService";

type DiagnosticsState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; diagnostics: NetworkDiagnostics }
  | { type: "error"; message: string };

type ProbeState =
  | { type: "idle" }
  | { type: "probing" }
  | { type: "done"; probe: PeerPortProbe }
  | { type: "error"; message: string };

type RepairState = "idle" | "running" | "launched" | "failed";

type DiagnosticsPanelProps = {
  connectionContext: ConnectionContext;
  defaultProbeHost?: string;
  onClose: () => void;
};

export function DiagnosticsPanel({ connectionContext, defaultProbeHost, onClose }: DiagnosticsPanelProps) {
  const [state, setState] = useState<DiagnosticsState>({ type: "idle" });
  const [probeHost, setProbeHost] = useState(defaultProbeHost ?? "");
  const [probeState, setProbeState] = useState<ProbeState>({ type: "idle" });
  const [repairState, setRepairState] = useState<RepairState>("idle");
  const [copied, setCopied] = useState<"report" | "command" | undefined>();
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    void refresh();
    return () => {
      disposedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!diagnosticsSupported()) {
      setState({ type: "error", message: "ネットワーク診断はデスクトップアプリでのみ利用できます。" });
      return;
    }
    setState({ type: "loading" });
    try {
      const diagnostics = await collectNetworkDiagnostics();
      if (!disposedRef.current) {
        setState({ type: "ready", diagnostics });
      }
    } catch (error) {
      if (!disposedRef.current) {
        setState({ type: "error", message: error instanceof Error ? error.message : "診断情報を取得できませんでした。" });
      }
    }
  }

  async function handleCopyReport() {
    if (state.type !== "ready") {
      return;
    }
    const report = buildDiagnosticReport(state.diagnostics, connectionContext);
    await navigator.clipboard?.writeText(report);
    setCopied("report");
    window.setTimeout(() => setCopied(undefined), 1800);
  }

  async function handleCopyRepairCommand() {
    const exePath = state.type === "ready" ? state.diagnostics.exePath : undefined;
    await navigator.clipboard?.writeText(firewallRepairCommand(exePath));
    setCopied("command");
    window.setTimeout(() => setCopied(undefined), 1800);
  }

  async function handleRepairFirewall() {
    setRepairState("running");
    try {
      await repairFirewallRules();
      if (!disposedRef.current) {
        setRepairState("launched");
        // Rules are recreated by an elevated child process; re-check shortly after.
        window.setTimeout(() => {
          if (!disposedRef.current) {
            void refresh();
          }
        }, 4000);
      }
    } catch {
      if (!disposedRef.current) {
        setRepairState("failed");
      }
    }
  }

  async function handleProbe() {
    const host = probeHost.trim();
    if (!host) {
      return;
    }
    setProbeState({ type: "probing" });
    try {
      const probe = await probePeerPorts(host);
      if (!disposedRef.current) {
        setProbeState({ type: "done", probe });
      }
    } catch (error) {
      if (!disposedRef.current) {
        setProbeState({ type: "error", message: error instanceof Error ? error.message : "診断できませんでした。" });
      }
    }
  }

  const diagnostics = state.type === "ready" ? state.diagnostics : undefined;

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-12 min-w-0 shrink-0 items-center border-b border-border px-3">
        <button
          type="button"
          id="diagnostics-back-btn"
          aria-label="戻る"
          title="戻る"
          onClick={onClose}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <Activity className="h-4 w-4 text-accent" />
          <div className="truncate text-[13px] font-semibold text-text">ネットワーク診断</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            id="diagnostics-refresh-btn"
            onClick={() => void refresh()}
            disabled={state.type === "loading"}
            className="kuno-focus-ring flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 text-[11px] font-semibold text-text transition-colors hover:bg-surface-hover disabled:text-faint"
          >
            {state.type === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            再取得
          </button>
          <button
            type="button"
            id="diagnostics-copy-report-btn"
            onClick={() => void handleCopyReport()}
            disabled={state.type !== "ready"}
            className="kuno-focus-ring flex h-8 items-center gap-1.5 rounded-input bg-accent px-2.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover disabled:bg-surface-active disabled:text-faint"
          >
            {copied === "report" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "report" ? "コピー済み" : "レポートをコピー"}
          </button>
        </div>
      </header>

      <div className="kuno-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {state.type === "loading" && !diagnostics ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            診断情報を取得しています…
          </div>
        ) : null}

        {state.type === "error" ? (
          <div className="rounded-card border border-danger/25 bg-red-50 px-3 py-3 text-[12px] text-danger dark:bg-red-950/30">
            {state.message}
          </div>
        ) : null}

        {diagnostics ? (
          <>
            <Section title="このPC">
              <InfoRow label="バージョン" value={`v${diagnostics.appVersion}`} />
              <InfoRow label="実行ファイル" value={diagnostics.exePath ?? "不明"} mono />
              <InfoRow label="LAN IP" value={diagnostics.lanIp ?? "不明"} mono />
              <InfoRow label="Tailscale IP" value={diagnostics.tailscaleIp ?? "なし"} mono />
              <StatusRow ok={diagnostics.listeners.tcpSignaling} label="TCP 8787(シグナリング待受)" failText="待受していません。アプリを再起動してください。" />
              <StatusRow ok={diagnostics.listeners.udpDiscovery} label="UDP 8788(LAN探索待受)" failText="待受していません。アプリを再起動してください。" />
              <StatusRow ok={diagnostics.listeners.tcpTransfer} label="TCP 8790(ファイル転送待受)" failText="待受していません。アプリを再起動してください。" />
            </Section>

            <Section title="Windowsファイアウォール">
              <FirewallSection
                diagnostics={diagnostics}
                repairState={repairState}
                copiedCommand={copied === "command"}
                onRepair={() => void handleRepairFirewall()}
                onCopyCommand={() => void handleCopyRepairCommand()}
              />
            </Section>

            <Section title="Tailscale">
              {diagnostics.tailscale.available ? (
                <>
                  <InfoRow label="自分のIP" value={diagnostics.tailscale.selfIp ?? "不明"} mono />
                  {diagnostics.tailscale.peers.length === 0 ? (
                    <div className="px-3 py-2.5 text-[11px] text-muted">Tailscaleピアが見つかりません。</div>
                  ) : (
                    diagnostics.tailscale.peers.map((peer, index) => (
                      <div key={`${peer.ip ?? index}`} className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-text">{peer.deviceName ?? peer.ip ?? "不明"}</div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{peer.ip ?? "IP不明"}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <Badge tone={peer.online ? "ok" : "muted"}>{peer.online ? "端末オンライン" : "端末オフライン"}</Badge>
                          {peer.online ? (
                            <Badge tone={peer.kunochatReachable === true ? "ok" : peer.kunochatReachable === false ? "danger" : "muted"}>
                              {peer.kunochatReachable === true
                                ? "KunoChat応答あり"
                                : peer.kunochatReachable === false
                                  ? "KunoChat応答なし"
                                  : "未確認"}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <div className="px-3 py-2.5 text-[11px] text-muted">
                  Tailscaleが見つかりません。{diagnostics.tailscale.error ? `(${diagnostics.tailscale.error})` : ""}
                </div>
              )}
            </Section>

            <Section title="相手の到達確認">
              <div className="px-3 py-3">
                <div className="text-[11px] leading-4 text-muted">相手のIPアドレス(例: 100.100.123.107)を入力して、KunoChatポートに届くか確認します。</div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="diagnostics-probe-host"
                    value={probeHost}
                    onChange={(event) => setProbeHost(event.target.value)}
                    placeholder="100.100.123.107"
                    autoComplete="off"
                    spellCheck={false}
                    className="kuno-focus-ring h-9 min-w-0 flex-1 rounded-input border border-border bg-surface px-2.5 font-mono text-[12px] text-text outline-none transition-colors placeholder:text-faint focus:border-accent"
                  />
                  <button
                    type="button"
                    id="diagnostics-probe-btn"
                    onClick={() => void handleProbe()}
                    disabled={probeState.type === "probing" || probeHost.trim().length === 0}
                    className="kuno-focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover disabled:bg-surface-active disabled:text-faint"
                  >
                    {probeState.type === "probing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    確認
                  </button>
                </div>
                {probeState.type === "done" ? (
                  <div className="mt-2 space-y-1">
                    <ProbeResultRow ok={probeState.probe.signalingReachable} label={`TCP 8787(シグナリング)${probeState.probe.signalingLatencyMs != null ? ` ${probeState.probe.signalingLatencyMs}ms` : ""}`} />
                    <ProbeResultRow ok={probeState.probe.transferReachable} label="TCP 8790(ファイル転送)" />
                    {!probeState.probe.signalingReachable ? (
                      <div className="rounded-input bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                        相手の端末には届いていますが、KunoChatが応答していません。相手側でKunoChatを起動・更新するか、相手側のネットワーク診断からファイアウォールを修復してください。
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {probeState.type === "error" ? (
                  <div className="mt-2 text-[11px] text-danger">{probeState.message}</div>
                ) : null}
              </div>
            </Section>

            <Section title="接続状況">
              <InfoRow
                label="最後の接続候補"
                value={
                  connectionContext.lastCandidate
                    ? `${connectionContext.lastCandidate.deviceName ?? connectionContext.lastCandidate.peerHint} (${connectionContext.lastCandidate.peerHint})`
                    : "なし"
                }
              />
              <InfoRow
                label="最後の接続失敗"
                value={
                  connectionContext.lastFailure
                    ? `${connectionContext.lastFailure.reason}(${new Date(connectionContext.lastFailure.at).toLocaleTimeString()})`
                    : "なし"
                }
              />
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FirewallSection({
  diagnostics,
  repairState,
  copiedCommand,
  onRepair,
  onCopyCommand
}: {
  diagnostics: NetworkDiagnostics;
  repairState: RepairState;
  copiedCommand: boolean;
  onRepair: () => void;
  onCopyCommand: () => void;
}) {
  const firewall = diagnostics.firewall;
  const status = firewallStatusLabel(firewall);
  const needsRepair = firewallNeedsRepair(firewall);

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2">
        {status.tone === "ok" ? (
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <ShieldAlert className={clsx("h-4 w-4 shrink-0", status.tone === "danger" ? "text-danger" : "text-amber-500")} />
        )}
        <div className="min-w-0 flex-1 text-[12px] font-semibold text-text">{status.label}</div>
      </div>
      {firewall.rules.length > 0 ? (
        <div className="mt-2 space-y-1">
          {firewall.rules.map((rule, index) => (
            <div key={`${rule.displayName}-${index}`} className="rounded-input bg-surface-hover px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[11px] font-semibold text-text">{rule.displayName}</div>
                <Badge tone={rule.action.toLowerCase() === "allow" ? "ok" : "danger"}>
                  {rule.direction} / {rule.action}
                </Badge>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{rule.program ?? "(パス不明)"}</div>
            </div>
          ))}
        </div>
      ) : null}
      {firewall.detail ? <div className="mt-2 text-[11px] text-muted">{firewall.detail}</div> : null}
      {firewall.supported ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {needsRepair ? (
            <button
              type="button"
              id="diagnostics-repair-firewall-btn"
              onClick={onRepair}
              disabled={repairState === "running"}
              className="kuno-focus-ring flex h-9 items-center gap-1.5 rounded-input bg-accent px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover disabled:bg-surface-active disabled:text-faint"
            >
              {repairState === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              ワンクリック修復(管理者権限)
            </button>
          ) : null}
          <button
            type="button"
            id="diagnostics-copy-repair-command-btn"
            onClick={onCopyCommand}
            className="kuno-focus-ring flex h-9 items-center gap-1.5 rounded-input border border-border bg-surface px-3 text-[12px] font-semibold text-text transition-colors hover:bg-surface-hover"
          >
            {copiedCommand ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedCommand ? "コピー済み" : "修復コマンドをコピー"}
          </button>
        </div>
      ) : null}
      {repairState === "launched" ? (
        <div className="mt-2 text-[11px] text-success">修復を実行しました。数秒後に自動で再確認します。</div>
      ) : null}
      {repairState === "failed" ? (
        <div className="mt-2 text-[11px] text-danger">
          修復を開始できませんでした。管理者権限の確認(UAC)で「はい」を選ぶか、修復コマンドをコピーして管理者PowerShellで実行してください。
        </div>
      ) : null}
      <div className="mt-2 text-[11px] leading-4 text-muted">
        相手のPCで受信がブロックされている場合は、修復コマンドをコピーして相手のPCの管理者PowerShellで実行してください。
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="border-b border-border/70 px-3 py-2 text-[11px] font-semibold text-muted">{title}</div>
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
      <div className="shrink-0 text-[11px] text-muted">{label}</div>
      <div className={clsx("min-w-0 truncate text-right text-[11px] font-semibold text-text", mono && "font-mono font-normal")} title={value}>
        {value}
      </div>
    </div>
  );
}

function StatusRow({ ok, label, failText }: { ok: boolean; label: string; failText: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text">{label}</div>
        {!ok ? <div className="mt-0.5 text-[10px] leading-4 text-danger">{failText}</div> : null}
      </div>
      <Badge tone={ok ? "ok" : "danger"}>{ok ? "OK" : "NG"}</Badge>
    </div>
  );
}

function ProbeResultRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-input bg-surface-hover px-2.5 py-1.5">
      <div className="text-[11px] text-text">{label}</div>
      <Badge tone={ok ? "ok" : "danger"}>{ok ? "到達" : "不達"}</Badge>
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "danger" | "muted"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "ok" && "bg-success/10 text-success",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "muted" && "bg-surface-hover text-muted"
      )}
    >
      {children}
    </span>
  );
}
