import clsx from "clsx";
import type { ConnectionStatus, MessageStatus } from "../features/chat/messageTypes";

type StatusDotProps = {
  status: ConnectionStatus | MessageStatus | "unread" | "transferring";
  label?: string;
  className?: string;
};

const statusClass: Record<string, string> = {
  connected: "bg-success",
  received: "bg-success",
  saved: "bg-success",
  sent: "bg-text",
  sending: "bg-warning",
  receiving: "bg-warning",
  transferring: "bg-warning",
  queued: "bg-faint",
  draft: "bg-faint",
  pairing: "bg-faint",
  connecting: "bg-warning",
  reconnecting: "bg-warning",
  offline: "bg-faint",
  failed: "bg-danger",
  cancelled: "bg-faint",
  unread: "bg-text"
};

export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <span
      aria-label={label ?? status}
      title={label ?? status}
      className={clsx("inline-flex h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.9)]", statusClass[status], className)}
    />
  );
}
