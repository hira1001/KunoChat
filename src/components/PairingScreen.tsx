import { AlertTriangle, Check, ChevronLeft, Copy, Laptop, Loader2, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import { useState, type FormEvent } from "react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { peerReachabilitySummary } from "../features/diagnostics/diagnosticsService";
import { BrandMark } from "./BrandMark";

type DetectedPeerOption = {
  id: string;
  signalingUrl: string;
  roomId: string;
  mode: "host" | "join";
  peerHint: string;
  source?: "lan" | "tailscale";
  deviceName?: string;
  platform?: string;
  reachable?: boolean;
  lastSeen: number;
};

type PairingScreenProps = {
  status: ConnectionStatus;
  signalingConfigured: boolean;
  pairingCode: string;
  signalingUrl: string;
  displayName: string;
  peerDisplayName?: string;
  detectedPeers: DetectedPeerOption[];
  selectedPeerId?: string;
  onBack: () => void;
  onConnect: (friendCode: string) => void;
  onConnectDetectedPeer: (peer: DetectedPeerOption) => void;
};

export function PairingScreen({
  status,
  signalingConfigured,
  pairingCode,
  signalingUrl,
  displayName,
  peerDisplayName,
  detectedPeers,
  selectedPeerId,
  onBack,
  onConnect,
  onConnectDetectedPeer
}: PairingScreenProps) {
  const [friendCode, setFriendCode] = useState("");
  const [copied, setCopied] = useState(false);
  const canConnect = pairingDigits(friendCode).length === 6;
  const isConnecting = status === "connecting" || status === "reconnecting";
  const canSubmitCode = canConnect && !isConnecting;
  const isConnected = status === "connected";
  const hasFailed = status === "failed";

  async function handleCopyCode() {
    await navigator.clipboard?.writeText(pairingCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmitCode) {
      onConnect(pairingDigits(friendCode));
    }
  }

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-12 min-w-0 shrink-0 items-center border-b border-border px-3">
        <button
          type="button"
          id="pairing-back-btn"
          aria-label="戻る"
          title="戻る"
          onClick={onBack}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <BrandMark className="h-5 w-5" />
          <div className="truncate text-[13px] font-semibold text-text">接続先を選ぶ</div>
        </div>
        <PairingStatus status={status} />
      </header>

      <div className="kuno-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-[300px]">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-accent-soft text-accent">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold text-text">{isConnected ? "接続済み" : hasFailed ? "接続できませんでした" : "2台のKunoChatを接続"}</h1>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                {isConnected
                  ? `${peerDisplayName || "相手"} と接続済みです。すぐに送信できます。`
                  : hasFailed
                    ? "相手PCでKunoChatが起動していることと、同じネットワークにいることを確認してください。"
                    : `${displayName}として待機中です。見つかった相手を選ぶか、相手の6桁コードを入力してください。`}
              </p>
            </div>
          </div>

          <section className="mt-7 border-y border-border py-4" aria-labelledby="your-code-label">
            <div id="your-code-label" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
              自分のコード
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[24px] font-semibold tracking-[0.16em] text-text">{pairingCode}</code>
              <button
                type="button"
                id="copy-pairing-code-btn"
                aria-label={copied ? "コピーしました" : "ペアリングコードをコピー"}
                title={copied ? "コピーしました" : "コードをコピー"}
                onClick={handleCopyCode}
                className={clsx(
                  "kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors",
                  copied ? "border-success/30 bg-success/10 text-success" : "border-border text-muted hover:bg-surface-hover hover:text-text"
                )}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted" aria-live="polite">
              {copied ? "コードをコピーしました。" : "相手にこの6桁を伝えてください。"}
            </p>
          </section>

          <section className="mt-6" aria-labelledby="detected-devices-label">
            <div id="detected-devices-label" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
              見つかった相手
            </div>
            <div className="mt-2 space-y-2">
              {detectedPeers.length > 0 ? (
                sortPeersByReachability(detectedPeers).map((peer) => {
                  const selected = peer.id === selectedPeerId;
                  const unreachable = peer.reachable === false;
                  const summary = peerReachabilitySummary(peer);
                  return (
                    <button
                      key={peer.id}
                      type="button"
                      onClick={() => onConnectDetectedPeer(peer)}
                      title={unreachable ? summary.guidance : undefined}
                      className={clsx(
                        "kuno-focus-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-input border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-accent bg-accent-soft"
                          : unreachable
                            ? "border-amber-200 bg-amber-50/60 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-950/20"
                            : "border-border bg-surface hover:border-accent hover:bg-surface-hover"
                      )}
                    >
                      <span
                        className={clsx(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                          unreachable ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" : "bg-accent-soft text-accent"
                        )}
                      >
                        {unreachable ? <AlertTriangle className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-text">{peer.deviceName || peer.peerHint}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {peerPlatformLabel(peer.platform)} / {peer.source === "tailscale" ? "Tailscale" : "LAN"} / {peer.peerHint}
                        </span>
                        {unreachable ? (
                          <span className="mt-0.5 block truncate text-[10px] font-semibold text-amber-600 dark:text-amber-300">{summary.label}</span>
                        ) : null}
                      </span>
                      <span className={clsx("shrink-0 text-[12px] font-semibold", unreachable ? "text-amber-600 dark:text-amber-300" : "text-accent")}>
                        {selected ? "接続中" : unreachable ? "応答なし" : "接続"}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-input border border-dashed border-border px-3 py-3 text-[11px] leading-5 text-muted">
                  近くの相手はまだ見つかっていません。相手PCでKunoChatを起動し、同じLANまたはTailscale上にいるか確認してください。
                </div>
              )}
            </div>
          </section>

          <form className="mt-6" onSubmit={handleSubmit}>
            <label className="block text-[12px] font-semibold text-text" htmlFor="friend-code">
              相手のコード
            </label>
            <input
              id="friend-code"
              value={friendCode}
              onChange={(event) => setFriendCode(formatPairingCode(event.target.value))}
              placeholder="000-000"
              autoComplete="off"
              inputMode="numeric"
              maxLength={32}
              className="kuno-focus-ring mt-2 h-11 w-full rounded-input border border-border bg-surface px-3 font-mono text-[15px] tracking-[0.14em] text-text outline-none transition-colors placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            <button
              type="submit"
              id="pairing-connect-btn"
              disabled={!canSubmitCode}
              className="kuno-focus-ring mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-input bg-accent px-4 text-[13px] font-semibold text-white transition-colors enabled:hover:bg-accent-hover enabled:active:scale-[0.99] disabled:bg-surface-active disabled:text-faint"
            >
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isConnecting ? "接続中" : "接続"}
            </button>
          </form>

          <p className="mt-4 text-[11px] leading-5 text-muted">{pairingHelpText(status, signalingConfigured, detectedPeers.length > 0 || Boolean(selectedPeerId), signalingUrl)}</p>
          <p className="mt-2 text-[11px] leading-5 text-faint">一度接続した相手はチャット一覧に残ります。次回からは相手を選ぶだけで送信できます。</p>
        </div>
      </div>
    </div>
  );
}

function PairingStatus({ status }: { status: ConnectionStatus }) {
  const connected = status === "connected";
  const connecting = status === "connecting" || status === "reconnecting";
  const failed = status === "failed";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-[11px] font-medium", connected ? "text-success" : failed ? "text-danger" : "text-muted")}>
      {connected ? <Wifi className="h-3.5 w-3.5" /> : connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
      {connected ? "接続済み" : connecting ? "接続中" : failed ? "失敗" : "待機中"}
    </span>
  );
}

function sortPeersByReachability(peers: DetectedPeerOption[]): DetectedPeerOption[] {
  return [...peers].sort((left, right) => {
    const leftDown = left.reachable === false ? 1 : 0;
    const rightDown = right.reachable === false ? 1 : 0;
    if (leftDown !== rightDown) {
      return leftDown - rightDown;
    }
    return right.lastSeen - left.lastSeen;
  });
}

function pairingDigits(value: string): string {
  return value.normalize("NFKC").replace(/\D/g, "").slice(0, 6);
}

function formatPairingCode(value: string): string {
  const digits = pairingDigits(value);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

function peerPlatformLabel(platform: string | undefined): string {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "Mac";
  if (platform === "linux") return "Linux";
  if (platform === "browser") return "ブラウザ";
  return "不明";
}

function pairingHelpText(status: ConnectionStatus, signalingConfigured: boolean, hasPeerTarget: boolean, _signalingUrl: string): string {
  if (!signalingConfigured) return "接続サービスを初期化できませんでした。アプリを再起動してください。";
  if (status === "connected") return "接続の準備が完了しました。";
  if (status === "failed") return "接続できませんでした。同じネットワークか、相手PCのKunoChatが開いているか確認してください。";
  if (status === "connecting" || status === "reconnecting") return "相手PCへ接続しています。時間がかかる場合は接続先を選び直してください。";
  if (!hasPeerTarget) return "相手が見つからない場合でも、6桁コードを入力して接続を試せます。";
  return "相手を選ぶか、相手のコードを入力してください。";
}
