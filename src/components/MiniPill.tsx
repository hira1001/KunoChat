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
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-[44px] w-[188px] items-center gap-2 rounded-[12px] border border-border bg-white px-4 text-left shadow-pill transition duration-150 hover:-translate-y-0.5 hover:bg-surface"
      data-tauri-drag-region
    >
      <span className="flex-1 text-[13px] font-semibold text-text">KunoChat</span>
      <StatusDot status={unreadCount > 0 ? "unread" : status} label={unreadCount > 0 ? "Unread" : status} />
      <ChevronRight className="h-4 w-4 text-slate-500" />
      {activeTransferCount > 0 ? (
        <span className="absolute inset-x-4 bottom-1 h-px overflow-hidden rounded-pill bg-surface-active">
          <span className="block h-full w-2/3 rounded-pill bg-text" />
        </span>
      ) : null}
    </button>
  );
}
