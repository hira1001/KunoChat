import { ChevronDown, Clock3, History, MessageCircle, Minimize2, Plus, Settings, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ConnectionStatus, ConversationSummary } from "../features/chat/messageTypes";
import { BrandMark } from "./BrandMark";
import { StatusDot } from "./StatusDot";

type HeaderProps = {
  status: ConnectionStatus;
  peerName: string;
  conversations: ConversationSummary[];
  activeConversationId: string;
  pendingByConversation?: Record<string, number>;
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
  pendingByConversation = {},
  onSettings,
  onHistory,
  onMini,
  onPair,
  onSelectConversation
}: HeaderProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const totalUnread = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const totalPending = Object.values(pendingByConversation).reduce((total, count) => total + count, 0);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activePending = pendingByConversation[activeConversationId] ?? 0;

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
          <IconButton id="header-mini-btn" label="ミニ表示" onClick={onMini}>
            <Minimize2 className="h-4 w-4" />
          </IconButton>
          <IconButton id="header-history-btn" label="履歴" onClick={onHistory}>
            <History className="h-4 w-4" />
          </IconButton>
          <IconButton id="header-settings-btn" label="設定" onClick={onSettings}>
            <Settings className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSelectorOpen((open) => !open)}
        aria-expanded={selectorOpen}
        aria-haspopup="menu"
        aria-label="トーク一覧を開く"
        title="トーク一覧を開く"
        className="kuno-focus-ring relative flex h-[46px] w-full min-w-0 items-center gap-2 border-t border-border/60 px-3 text-left transition-colors hover:bg-surface-hover/70 active:scale-[0.995]"
      >
        <span className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 text-[10px] font-semibold text-muted shadow-sm">
          <MessageCircle className="h-3.5 w-3.5" />
          トーク
          {totalUnread > 0 ? <Badge value={totalUnread} tone="danger" className="absolute -right-1.5 -top-1" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-semibold text-text">{peerName}</span>
            {activePending > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                <Clock3 className="h-3 w-3" />
                {activePending}
              </span>
            ) : null}
          </div>
          <div className="mt-px flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted">
            {status === "connected" ? (
              <Wifi className="h-2.5 w-2.5 text-success" />
            ) : status === "connecting" || status === "reconnecting" ? (
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-warning border-t-transparent" />
            ) : (
              <WifiOff className="h-2.5 w-2.5 text-faint" />
            )}
            <span className="truncate">{connectionLabel(status, activePending)}</span>
            <StatusDot status={status} className="h-1.5 w-1.5" />
          </div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>

      {selectorOpen ? (
        <div className="absolute left-3 right-3 top-[94px] z-50 overflow-hidden rounded-card border border-border bg-bg shadow-window" role="menu">
          <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-text">トーク一覧</div>
              <div className="truncate text-[10px] text-muted">
                {totalPending > 0 ? `送信待ち ${totalPending}件` : "相手を選ぶだけで送信できます"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectorOpen(false);
                onPair();
              }}
              className="kuno-focus-ring inline-flex h-8 shrink-0 items-center gap-1 rounded-input bg-accent px-2.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              追加
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const pending = pendingByConversation[conversation.id] ?? 0;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    setSelectorOpen(false);
                  }}
                  className={`kuno-focus-ring flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-input px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-accent-soft text-text" : "hover:bg-surface-hover"
                  }`}
                >
                  <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-[11px] font-bold text-muted">
                    {initialFor(conversation.displayName)}
                    <StatusDot status={conversation.connectionStatus ?? "pairing"} className="absolute -right-0.5 bottom-0 h-2.5 w-2.5 ring-2 ring-bg" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold">{conversation.displayName}</span>
                      {pending > 0 ? <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-100">待ち {pending}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">{conversation.lastMessagePreview || conversation.peerHint || "まだメッセージはありません"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {conversation.lastMessageAt ? <span className="text-[10px] text-faint">{relativeTime(conversation.lastMessageAt)}</span> : null}
                    {conversation.unreadCount > 0 ? <Badge value={conversation.unreadCount} tone="danger" /> : pending > 0 ? <Badge value={pending} tone="warning" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function IconButton({ id, label, onClick, children }: { id: string; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  );
}

function Badge({ value, tone, className }: { value: number; tone: "danger" | "warning"; className?: string }) {
  const label = value > 99 ? "99+" : String(value);
  return (
    <span
      className={`${className ?? ""} grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white shadow-sm ${
        tone === "danger" ? "bg-red-500" : "bg-amber-500"
      }`}
    >
      {label}
    </span>
  );
}

function connectionLabel(status: ConnectionStatus, pendingCount: number): string {
  if (pendingCount > 0 && status !== "connected") {
    return "相手が開いたら送信されます";
  }
  switch (status) {
    case "connected":
      return "オンライン";
    case "connecting":
      return "接続中";
    case "reconnecting":
      return "再接続中";
    case "offline":
      return "オフライン";
    case "failed":
      return "接続待機中";
    case "pairing":
      return "ペアリング待機中";
  }
}

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "K";
}

function relativeTime(value: number): string {
  const now = Date.now();
  const diff = now - value;
  if (diff < 60_000) return "今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分`;
  if (diff < 86_400_000) return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return new Date(value).toLocaleDateString([], { month: "numeric", day: "numeric" });
}
