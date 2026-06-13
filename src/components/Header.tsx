import { MoreHorizontal } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  onSettings: () => void;
};

export function Header({ status, peerName, onSettings }: HeaderProps) {
  return (
    <header className="w-full min-w-0 max-w-full shrink-0 overflow-hidden border-b border-border bg-white/96 shadow-[0_1px_0_rgba(16,24,40,0.02)]">
      <div className="flex h-[44px] min-w-0 items-center px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 truncate text-[14px] font-semibold text-text">
            KunoChat
          </div>
          <StatusDot status={status} className="h-2.5 w-2.5" />
        </div>
      </div>
      <div className="relative flex h-[48px] min-w-0 items-center justify-center border-t border-border/70 px-12">
        <div className="min-w-0 max-w-full text-center">
          <div className="truncate text-[13px] font-semibold text-text">{peerName}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] font-medium text-muted">
            <span className="truncate">{connectionLabel(status)}</span>
            <StatusDot status={status} className="h-1.5 w-1.5" />
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
          className="kuno-focus-ring absolute right-3 grid h-8 w-8 place-items-center rounded-pill text-muted transition hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "オンライン";
    case "connecting":
      return "接続中...";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    case "failed":
      return "Failed";
    case "pairing":
      return "Pairing";
  }
}
