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
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center border-b border-border px-3">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-pill text-slate-500 hover:bg-surface"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="ml-1 text-[14px] font-semibold text-text">
          KunoChat
        </div>
      </header>
      <div className="kuno-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex min-h-full max-w-[292px] flex-col justify-start sm:justify-center">
          <div className="mx-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-slate-500">
            <UsersRound className="h-4 w-4" />
          </div>
          <div className="mt-2 text-center text-[16px] font-semibold text-text">ペアリング</div>
          <div className="mt-1 text-center text-[11px] text-muted">相手にあなたのコードを伝えてください</div>
          <div className="mt-3 rounded-[12px] border border-border bg-white p-3 shadow-card">
            <div className="text-[11px] text-muted">あなたのコード</div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 font-mono text-[20px] font-semibold tracking-[0.16em] text-text">{pairingCode}</span>
              <button
                type="button"
                aria-label="Copy pairing code"
                title="Copy pairing code"
                onClick={handleCopyCode}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-pill text-slate-500 hover:bg-surface-hover"
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
            className="mt-1.5 h-9 rounded-[10px] border border-border bg-white px-3 text-[13px] outline-none focus:border-border-strong"
          />
          <button
            type="button"
            onClick={() => onConnect(friendCode)}
            className="mt-2.5 flex h-10 items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] disabled:bg-surface-active disabled:text-faint disabled:shadow-none"
            disabled={!canConnect}
          >
            {status === "connecting" ? "接続中..." : "接続する"}
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="mt-2.5 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-center text-[11px] leading-4 text-muted">
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
