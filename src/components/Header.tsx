import { History, Minimize2, Settings, Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";
import { BrandMark } from "./BrandMark";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  onSettings: () => void;
  onHistory: () => void;
  onMini: () => void;
  onPair: () => void;
};

export function Header({ status, peerName, onSettings, onHistory, onMini, onPair }: HeaderProps) {
  const isOnline = status === "connected";
  const isReconnecting = status === "reconnecting" || status === "connecting";

  return (
    <header className="w-full min-w-0 max-w-full shrink-0 overflow-hidden border-b border-border bg-bg-glass backdrop-blur-[20px]">
      {/* Top bar: Brand + actions */}
      <div className="flex h-[46px] min-w-0 items-center gap-3 px-4">
        {/* Brand */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandMark />
          <span className="min-w-0 truncate text-[13px] font-semibold text-text">
            KunoChat
          </span>
        </div>
        {/* Header Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            id="header-mini-btn"
            aria-label="ミニ表示"
            title="ミニ表示"
            onClick={onMini}
            className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-95"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
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
            aria-label="設定"
            title="設定"
            onClick={onSettings}
            className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-95"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom bar: Peer info */}
      <button
        type="button"
        onClick={isOnline ? undefined : onPair}
        disabled={isOnline}
        aria-label={isOnline ? `${peerName} と接続済み` : "Pair a device"}
        title={isOnline ? undefined : "Pair a device"}
        className="kuno-focus-ring relative flex h-[38px] min-w-0 w-full items-center justify-center border-t border-border/60 px-14 text-center transition-colors enabled:hover:bg-surface-hover/70 enabled:active:scale-[0.995] disabled:cursor-default"
      >
        <div className="min-w-0 max-w-full text-center">
          <div className="truncate text-[12px] font-semibold text-text">
            {peerName}
          </div>
          <div className="mt-px flex items-center justify-center gap-1.5 text-[10px] font-medium text-muted">
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
      </button>
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
