import clsx from "clsx";
import { Check, CheckCheck, CircleX, Clock3, RotateCcw, TriangleAlert, X } from "lucide-react";
import { formatTime } from "../features/chat/format";
import type { ChatMessage } from "../features/chat/messageTypes";
import { BundleCard } from "./BundleCard";
import { FileCard } from "./FileCard";
import { ImageCard } from "./ImageCard";

type MessageBubbleProps = {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  onCancel?: (messageId: string) => void;
};

export function MessageBubble({ message, onRetry, onCancel }: MessageBubbleProps) {
  const mine = message.sender === "me";
  const isAsset = message.kind === "file" || message.kind === "image" || message.kind === "bundle";
  const canRetry = mine && (message.status === "failed" || message.status === "cancelled") && Boolean(onRetry);
  const canCancel = mine && (message.status === "sending" || message.status === "queued") && Boolean(onCancel);

  return (
    <div className={clsx("kuno-message-enter flex w-full min-w-0 gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine ? (
        <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-white text-[10px] font-semibold text-muted shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          {message.senderName.trim().charAt(0).toUpperCase() || "P"}
        </div>
      ) : null}
      <div className={clsx("flex min-w-0 max-w-[82%] flex-col", mine ? "items-end" : "items-start", isAsset ? "w-[248px]" : "")}>
        {message.kind === "text" && message.text ? (
          <div
            className={clsx(
              "max-w-full break-words rounded-[16px] px-3.5 py-2.5 text-[13px] leading-5 shadow-card",
              mine
                ? "bg-accent text-white shadow-[0_10px_24px_rgba(33,102,243,0.22)]"
                : "border border-border bg-white text-text"
            )}
          >
            {message.text.text}
          </div>
        ) : null}

        {message.kind === "image" && message.asset ? (
          <ImageCard asset={message.asset} status={message.status} progress={message.progress} variant="message" />
        ) : null}

        {message.kind === "file" && message.asset ? (
          <FileCard
            asset={message.asset}
            status={message.status}
            progress={message.progress}
            error={message.error?.message}
          />
        ) : null}

        {message.kind === "bundle" && message.bundle ? (
          <BundleCard bundle={message.bundle} status={message.status} />
        ) : null}

        {message.kind === "system" ? (
          <div className="max-w-full break-words rounded-pill border border-border bg-white/80 px-3 py-1.5 text-[12px] text-muted shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            {message.text?.text ?? "System update"}
          </div>
        ) : null}
        <div className={clsx("mt-1 flex max-w-full flex-wrap items-center gap-1 text-[10px] text-faint", mine ? "mr-1 justify-end" : "ml-1")}>
          <span>{formatTime(message.createdAt)}</span>
          {mine ? <MessageStatusIcon status={message.status} /> : null}
          {canCancel ? (
            <button
              type="button"
              aria-label="Cancel send"
              title="Cancel send"
              onClick={() => onCancel?.(message.id)}
              className="kuno-focus-ring ml-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-pill border border-border bg-white px-2 text-[10px] font-semibold text-muted shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:bg-surface-hover hover:text-text"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          ) : null}
          {canRetry ? (
            <button
              type="button"
              aria-label="Retry send"
              title="Retry send"
              onClick={() => onRetry?.(message.id)}
              className="kuno-focus-ring ml-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-pill border border-red-100 bg-white px-2 text-[10px] font-semibold text-danger shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:bg-red-50"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageStatusIcon({ status }: { status: ChatMessage["status"] }) {
  if (status === "sending" || status === "queued") {
    return <Clock3 className="h-3 w-3 text-faint" />;
  }

  if (status === "sent") {
    return <Check className="h-3 w-3 text-accent" />;
  }

  if (status === "received" || status === "saved") {
    return <CheckCheck className="h-3 w-3 text-accent" />;
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-danger">
        <TriangleAlert className="h-3 w-3" />
        {statusLabel(status)}
      </span>
    );
  }

  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-0.5 text-faint">
        <CircleX className="h-3 w-3" />
        {statusLabel(status)}
      </span>
    );
  }

  return null;
}

function statusLabel(status: ChatMessage["status"]): string {
  switch (status) {
    case "queued":
      return "Waiting";
    case "sending":
      return "Sending";
    case "receiving":
      return "Receiving";
    case "received":
    case "saved":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
