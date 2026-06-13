import { ArrowRight, ChevronLeft, Copy, UsersRound } from "lucide-react";
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
  const canConnect = friendCode.trim().replace(/\D/g, "").length >= 6;

  async function handleCopyCode() {
    await navigator.clipboard?.writeText(pairingCode);
  }

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-11 min-w-0 shrink-0 items-center overflow-hidden border-b border-border bg-white/96 px-3">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-pill text-muted hover:bg-surface"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="ml-1 min-w-0 truncate text-[14px] font-semibold text-text">
          KunoChat
        </div>
      </header>
      <div className="kuno-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
        <div className="mx-auto flex min-h-full w-full max-w-[292px] min-w-0 flex-col justify-start sm:justify-center">
          <div className="mx-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-white text-muted shadow-card">
            <UsersRound className="h-4 w-4" />
          </div>
          <div className="mt-2 text-center text-[16px] font-semibold text-text">ペアリング</div>
          <div className="mt-1 text-center text-[11px] text-muted">相手にあなたのコードを伝えてください</div>
          <div className="mt-3 w-full min-w-0 overflow-hidden rounded-[13px] border border-border bg-white p-3 shadow-card">
            <div className="text-[11px] text-muted">あなたのコード</div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[20px] font-semibold tracking-[0.16em] text-text">{pairingCode}</span>
              <button
                type="button"
                aria-label="Copy pairing code"
                title="Copy pairing code"
                onClick={handleCopyCode}
                className="kuno-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-pill text-muted hover:bg-surface-hover"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="mt-3 block text-[12px] font-medium text-text" htmlFor="friend-code">
            相手のコードを入力
          </label>
          <input
            id="friend-code"
            value={friendCode}
            onChange={(event) => setFriendCode(formatPairingCode(event.target.value))}
            placeholder="6桁のコードを入力"
            className="kuno-focus-ring mt-1.5 h-9 w-full rounded-[11px] border border-border bg-white px-3 text-[13px] outline-none focus:border-border-strong"
          />
          <button
            type="button"
            onClick={() => onConnect(friendCode)}
            className="kuno-focus-ring mt-2.5 flex h-10 items-center justify-center gap-2 rounded-[11px] bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(33,102,243,0.24)] transition enabled:hover:-translate-y-0.5 disabled:bg-surface-active disabled:text-faint disabled:shadow-none"
            disabled={!canConnect}
          >
            {status === "connecting" ? "接続中..." : "接続する"}
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="mt-2.5 break-words rounded-[11px] border border-border bg-white/76 px-3 py-1.5 text-center text-[11px] leading-4 text-muted shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            {pairingHelpText(status, signalingConfigured, signalingUrl)}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatPairingCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

function pairingHelpText(status: ConnectionStatus, signalingConfigured: boolean, signalingUrl: string): string {
  if (!signalingConfigured) {
    return "シグナリングURLが未設定です。";
  }

  if (status === "connected") {
    return "接続済みです。メッセージは即時送信できます。";
  }

  if (status === "failed") {
    return `接続できません。同じWi-Fi/LANでKunoChatを開いているか確認してください。設定URL: ${signalingUrl}`;
  }

  if (status === "connecting") {
    return "接続準備中です。相手がコードを入力すると直接P2Pでつながります。";
  }

  return "同じWi-Fi/LANでは通常、自動で相手を見つけます。コード入力は手動接続用です。";
}
