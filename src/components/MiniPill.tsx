import { ChevronRight } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";

type MiniPillProps = {
  status: ConnectionStatus;
  unreadCount: number;
  activeTransferCount: number;
  onOpen: () => void;
};

export function MiniPill({ status, unreadCount, activeTransferCount, onOpen }: MiniPillProps) {
  const dotStatus = unreadCount > 0 ? "unread" : status;
  const dotLabel = unreadCount > 0 ? `${unreadCount} unread` : status;
  const transferProgress = activeTransferCount > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="kuno-focus-ring kuno-shell-expand relative flex h-[44px] w-[188px] items-center gap-2.5 rounded-[13px] border border-border bg-bg-glass px-4 text-left shadow-pill backdrop-blur-[20px] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-window active:translate-y-0 active:scale-[0.98]"
      data-tauri-drag-region
    >
      {/* Logo dot accent */}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="flex-1 text-[13px] font-semibold tracking-[-0.01em] text-text">KunoChat</span>
      <StatusDot status={dotStatus} label={dotLabel} />
      <ChevronRight className="h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5" />
      {/* Transfer progress strip */}
      {transferProgress ? (
        <span
          className="kuno-progress-shimmer absolute inset-x-4 bottom-1 h-[3px] overflow-hidden rounded-pill bg-accent/20"
          aria-label="Transfer in progress"
        >
          <span className="block h-full w-3/4 rounded-pill bg-gradient-to-r from-accent to-accent-hover" />
        </span>
      ) : null}
    </button>
  );
}
