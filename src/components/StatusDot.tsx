import clsx from "clsx";
import type { ConnectionStatus, MessageStatus } from "../features/chat/messageTypes";

type StatusDotProps = {
  status: ConnectionStatus | MessageStatus | "unread" | "transferring";
  label?: string;
  className?: string;
};

const statusConfig: Record<string, { color: string; pulse?: string }> = {
  connected:    { color: "bg-success",  pulse: "kuno-pulse-connected" },
  received:     { color: "bg-success" },
  saved:        { color: "bg-success" },
  sent:         { color: "bg-text" },
  sending:      { color: "bg-warning",  pulse: "kuno-pulse-warning" },
  receiving:    { color: "bg-warning",  pulse: "kuno-pulse-warning" },
  transferring: { color: "bg-warning",  pulse: "kuno-pulse-warning" },
  queued:       { color: "bg-faint" },
  draft:        { color: "bg-faint" },
  pairing:      { color: "bg-faint" },
  connecting:   { color: "bg-warning",  pulse: "kuno-pulse-warning" },
  reconnecting: { color: "bg-warning",  pulse: "kuno-pulse-warning" },
  offline:      { color: "bg-faint" },
  failed:       { color: "bg-danger" },
  cancelled:    { color: "bg-faint" },
  unread:       { color: "bg-accent" }
};

export function StatusDot({ status, label, className }: StatusDotProps) {
  const config = statusConfig[status] ?? { color: "bg-faint" };

  return (
    <span
      aria-label={label ?? status}
      title={label ?? status}
      className={clsx(
        "inline-flex h-2 w-2 shrink-0 rounded-full",
        "shadow-[0_0_0_2px_rgba(var(--bg-rgb,250,251,255),0.9)]",
        config.color,
        config.pulse,
        className
      )}
    />
  );
}
