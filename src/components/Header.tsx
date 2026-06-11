import { MoreHorizontal, Minus, X } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  onMini: () => void;
  onSettings: () => void;
};

export function Header({ status, peerName, onMini, onSettings }: HeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-white">
      <div className="flex h-[46px] items-center px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2" data-tauri-drag-region>
          <div className="text-[14px] font-semibold text-text" data-tauri-drag-region>
            KunoChat
          </div>
          <StatusDot status={status} className="h-2.5 w-2.5" />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mini"
            title="Mini"
            onClick={onMini}
            className="grid h-8 w-8 place-items-center rounded-pill text-slate-500 hover:bg-surface-hover hover:text-text"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Hide"
            title="Hide"
            onClick={onMini}
            className="grid h-8 w-8 place-items-center rounded-pill text-slate-500 hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative flex h-[46px] items-center justify-center border-t border-border/70 px-4">
        <div className="text-center">
          <div className="text-[13px] font-semibold text-text">{peerName}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] text-muted">
            <span>{connectionLabel(status)}</span>
            <StatusDot status={status} className="h-1.5 w-1.5" />
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
          className="absolute right-3 grid h-8 w-8 place-items-center rounded-pill text-slate-500 hover:bg-surface-hover hover:text-text"
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
