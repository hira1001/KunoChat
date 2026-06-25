import { ChevronRight } from "lucide-react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";
import { BrandMark } from "./BrandMark";

type MiniPillProps = {
  status: ConnectionStatus;
  unreadCount: number;
  activeTransferCount: number;
  onOpen: () => void;
};

export function MiniPill({ status, unreadCount, activeTransferCount, onOpen }: MiniPillProps) {
  const transferProgress = activeTransferCount > 0;
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="kuno-focus-ring kuno-shell-expand relative flex h-[44px] w-full max-w-[188px] min-w-0 items-center gap-2.5 rounded-card border border-border bg-bg-glass px-4 text-left shadow-pill backdrop-blur-[20px] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-window active:translate-y-0 active:scale-[0.98]"
      data-tauri-drag-region
    >
      <BrandMark />
      <span className="flex-1 text-[13px] font-semibold tracking-[-0.01em] text-text">KunoChat</span>
      {unreadCount > 0 ? (
        <span
          aria-label={`${unreadCount} unread messages`}
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-accent px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unreadLabel}
        </span>
      ) : (
        <StatusDot status={status} label={status} />
      )}
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
