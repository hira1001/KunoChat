import { ChevronDown, History, MessageCircle, Minimize2, Settings, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, ConversationSummary } from "../features/chat/messageTypes";
import { BrandMark } from "./BrandMark";
import { StatusDot } from "./StatusDot";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  conversations: ConversationSummary[];
  activeConversationId: string;
  onSettings: () => void;
  onHistory: () => void;
  onMini: () => void;
  onPair: () => void;
  onSelectConversation: (conversationId: string) => void;
};

export function Header({
  status,
  peerName,
  conversations,
  activeConversationId,
  onSettings,
  onHistory,
  onMini,
  onPair,
  onSelectConversation
}: HeaderProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const isOnline = status === "connected";
  const isReconnecting = status === "reconnecting" || status === "connecting";
  const totalUnread = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);

  useEffect(() => {
    if (!selectorOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectorOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && selectorRef.current && !selectorRef.current.contains(target)) {
        setSelectorOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [selectorOpen]);

  return (
    <header ref={selectorRef} className="relative z-20 w-full min-w-0 max-w-full shrink-0 overflow-visible border-b border-border bg-bg-glass backdrop-blur-[20px]">
      <div className="flex h-[46px] min-w-0 items-center gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandMark />
          <span className="min-w-0 truncate text-[13px] font-semibold text-text">KunoChat</span>
        </div>
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
            aria-label="履歴"
            title="履歴"
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

      <button
        type="button"
        onClick={() => setSelectorOpen((open) => !open)}
        aria-expanded={selectorOpen}
        aria-haspopup="menu"
        aria-label="チャットを切り替え"
        title="チャットを切り替え"
        className="kuno-focus-ring relative flex h-[42px] w-full min-w-0 items-center gap-2 border-t border-border/60 px-3 text-left transition-colors hover:bg-surface-hover/70 active:scale-[0.995]"
      >
        <span className="relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill bg-surface px-2 text-[10px] font-semibold text-muted shadow-sm">
          <MessageCircle className="h-3.5 w-3.5" />
          チャット
          {totalUnread > 0 ? (
            <span className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-pill bg-red-500 px-1 text-[9px] font-bold text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-text">{peerName}</div>
          <div className="mt-px flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted">
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
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>

      {selectorOpen ? (
        <div className="absolute left-3 right-3 top-[90px] z-50 overflow-hidden rounded-card border border-border bg-bg shadow-window" role="menu">
          <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
            <span className="shrink-0 text-[12px] font-semibold text-text">チャット一覧</span>
            <span className="min-w-0 truncate text-[10px] text-muted">オフラインでも送信待ちにできます</span>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    setSelectorOpen(false);
                  }}
                  className={`kuno-focus-ring flex min-h-12 w-full min-w-0 items-center gap-2 rounded-input px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-accent-soft text-text" : "hover:bg-surface-hover"
                  }`}
                >
                  <StatusDot status={conversation.connectionStatus ?? "pairing"} className="h-2 w-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{conversation.displayName}</span>
                    <span className="block truncate text-[10px] text-muted">{conversation.lastMessagePreview || conversation.peerHint || "まだメッセージはありません"}</span>
                  </span>
                  {conversation.unreadCount > 0 ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-pill bg-red-500 px-1 text-[10px] font-bold text-white">
                      {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectorOpen(false);
              onPair();
            }}
            className="kuno-focus-ring flex h-9 w-full items-center justify-center border-t border-border text-[11px] font-semibold text-accent transition-colors hover:bg-accent-soft"
          >
            接続先を選ぶ
          </button>
        </div>
      ) : null}
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
      return "再接続中...";
    case "offline":
      return "オフライン";
    case "failed":
      return "接続失敗";
    case "pairing":
      return "ペアリング待機中";
  }
}
