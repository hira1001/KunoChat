import { History, MoreHorizontal, Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  onSettings: () => void;
  onHistory: () => void;
};

export function Header({ status, peerName, onSettings, onHistory }: HeaderProps) {
  const isOnline = status === "connected";
  const isReconnecting = status === "reconnecting" || status === "connecting";

  return (
    <header className="w-full min-w-0 max-w-full shrink-0 overflow-hidden border-b border-border bg-bg-glass backdrop-blur-[20px]">
      {/* Top bar: Brand + actions */}
      <div className="flex h-[44px] min-w-0 items-center gap-3 px-4">
        {/* Brand */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent">
            <span className="h-2 w-2 rounded-sm bg-white" />
          </span>
          <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
            KunoChat
          </span>
        </div>
        {/* Header Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            id="header-history-btn"
            aria-label="History"
            title="History"
            onClick={onHistory}
            className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-95"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            id="header-settings-btn"
            aria-label="Settings"
            title="Settings"
            onClick={onSettings}
            className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-95"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom bar: Peer info */}
      <div className="relative flex h-[48px] min-w-0 items-center justify-center border-t border-border/60 px-14">
        <div className="min-w-0 max-w-full text-center">
          <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
            {peerName}
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] font-medium text-muted">
            {isOnline ? (
              <Wifi className="h-2.5 w-2.5 text-success" />
            ) : isReconnecting ? (
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-warning border-t-transparent" />
            ) : (
              <WifiOff className="h-2.5 w-2.5 text-faint" />
            )}
            <span className="truncate">{connectionLabel(status)}</span>
            <StatusDot status={status} className="h-1.5 w-1.5" />
          </div>
        </div>
      </div>
    </header>
  );
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":    return "オンライン";
    case "connecting":   return "接続中...";
    case "reconnecting": return "再接続中...";
    case "offline":      return "オフライン";
    case "failed":       return "接続失敗";
    case "pairing":      return "ペアリング待機中";
  }
}
