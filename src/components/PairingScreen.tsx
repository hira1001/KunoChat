import { ArrowRight, ChevronLeft, Copy, Check, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ConnectionStatus } from "../features/chat/messageTypes";

type PairingScreenProps = {
  status: ConnectionStatus;
  signalingConfigured: boolean;
  pairingCode: string;
  signalingUrl: string;
  onBack: () => void;
  onConnect: (friendCode: string) => void;
};

export function PairingScreen({ status, signalingConfigured, pairingCode, signalingUrl, onBack, onConnect }: PairingScreenProps) {
  const [friendCode, setFriendCode] = useState("");
  const [copied, setCopied] = useState(false);
  const canConnect = friendCode.trim().replace(/\D/g, "").length >= 6;
  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  async function handleCopyCode() {
    await navigator.clipboard?.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex h-11 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-bg-glass px-3 backdrop-blur-[20px]">
        <button
          type="button"
          id="pairing-back-btn"
          aria-label="戻る"
          onClick={onBack}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-90"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent">
          <span className="h-1.5 w-1.5 rounded-sm bg-white" />
        </span>
        <div className="ml-0.5 min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
          KunoChat
        </div>
      </header>

      {/* Body */}
      <div className="kuno-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5">
        <div className="mx-auto flex min-h-full w-full max-w-[292px] min-w-0 flex-col justify-start sm:justify-center">

          {/* Icon + Title */}
          <div className="kuno-fade-in text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft">
              {isConnected ? (
                <Wifi className="h-7 w-7 text-success" />
              ) : isConnecting ? (
                <Loader2 className="h-7 w-7 animate-spin text-accent" />
              ) : (
                <WifiOff className="h-7 w-7 text-accent" />
              )}
            </div>
            <div className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-text">ペアリング</div>
            <div className="mt-1 text-[12px] leading-[1.6] text-muted">
              相手にあなたのコードを伝えてください
            </div>
          </div>

          {/* Your code card */}
          <div className="mt-5 w-full min-w-0 overflow-hidden rounded-[14px] border border-border bg-surface p-4 shadow-card">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">あなたのコード</div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[22px] font-bold tracking-[0.18em] text-text">
                {pairingCode}
              </span>
              <button
                type="button"
                id="copy-pairing-code-btn"
                aria-label="ペアリングコードをコピー"
                title="コピー"
                onClick={handleCopyCode}
                className={clsx(
                  "kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-200 active:scale-90",
                  copied
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-surface-hover text-muted hover:border-border-strong hover:text-text"
                )}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Friend code input */}
          <label className="mt-5 block text-[12px] font-semibold text-text" htmlFor="friend-code">
            相手のコードを入力
          </label>
          <input
            id="friend-code"
            value={friendCode}
            onChange={(event) => setFriendCode(formatPairingCode(event.target.value))}
            placeholder="000-000"
            maxLength={7}
            className="kuno-focus-ring mt-1.5 h-10 w-full rounded-[11px] border border-border bg-surface px-3 font-mono text-[14px] tracking-[0.12em] text-text outline-none transition-all duration-200 placeholder:text-faint focus:border-accent/50 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />

          {/* Connect button */}
          <button
            type="button"
            id="pairing-connect-btn"
            onClick={() => onConnect(friendCode)}
            disabled={!canConnect || isConnecting}
            className="kuno-focus-ring mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[11px] bg-accent px-4 text-[13px] font-semibold text-white shadow-accent transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-accent-hover enabled:hover:shadow-[0_12px_30px_var(--accent-glow)] enabled:active:translate-y-0 enabled:active:scale-[0.98] disabled:bg-surface-active disabled:text-faint disabled:shadow-none"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                接続中...
              </>
            ) : (
              <>
                接続する
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          {/* Help text */}
          <div className="mt-3 break-words rounded-[11px] border border-border bg-surface/60 px-3 py-2.5 text-center text-[11px] leading-[1.6] text-muted backdrop-blur-[8px]">
            {pairingHelpText(status, signalingConfigured, signalingUrl)}
          </div>
        </div>
      </div>
    </div>
  );
}

// clsx import needed for Copy button state
import clsx from "clsx";

function formatPairingCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

function pairingHelpText(status: ConnectionStatus, signalingConfigured: boolean, signalingUrl: string): string {
  if (!signalingConfigured) return "シグナリングURLが未設定です。";
  if (status === "connected") return "✓ 接続済みです。すぐにメッセージを送れます。";
  if (status === "failed") return `接続できません。同じWi-Fi/LANでお試しください。${signalingUrl}`;
  if (status === "connecting") return "相手がコードを入力すると直接P2Pでつながります。";
  return "同じWi-Fi/LANでは通常、自動でペアリングを試みます。";
}
