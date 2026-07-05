import clsx from "clsx";
import type { ReactNode } from "react";
import { Check, CheckCheck, CircleX, Clock3, Pause, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import { formatTime } from "../features/chat/format";
import type { ChatMessage } from "../features/chat/messageTypes";
import { useChatStore } from "../features/chat/chatStore";
import { BundleCard } from "./BundleCard";
import { FileCard } from "./FileCard";
import { ImageCard } from "./ImageCard";

type MessageBubbleProps = {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  onCancel?: (messageId: string) => void;
  onPause?: (messageId: string) => void;
  onResume?: (messageId: string) => void;
  onDownload?: (messageId: string) => void;
};

export function MessageBubble({ message, onRetry, onCancel, onPause, onResume, onDownload }: MessageBubbleProps) {
  const mine = message.sender === "me";
  const transferState = useChatStore((state) => state.transferStates[message.asset?.transferId || ""]);
  const isAsset = message.kind === "file" || message.kind === "image" || message.kind === "bundle";
  const waitingForConnection = message.status === "queued" && message.error?.code === "pending_connection";
  const canRetry = mine && (message.status === "failed" || message.status === "cancelled") && Boolean(onRetry);
  const canCancel = mine && (message.status === "sending" || message.status === "queued") && Boolean(onCancel);
  const isPaused = isAsset && message.status === "queued" && mine && !waitingForConnection;
  const canPause = mine && message.status === "sending" && Boolean(onPause);
  const canResume = mine && isPaused && Boolean(onResume);
  const canDownload = !mine && (message.status === "queued" || message.status === "failed") && Boolean(onDownload);

  return (
    <div className={clsx("kuno-message-enter flex w-full min-w-0 gap-2.5", mine ? "justify-end" : "justify-start")}>
      {!mine ? (
        <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-[10px] font-bold text-muted shadow-card">
          {message.senderName.trim().charAt(0).toUpperCase() || "P"}
        </div>
      ) : null}

      <div className={clsx("flex min-w-0 max-w-[82%] flex-col", mine ? "items-end" : "items-start", isAsset ? "w-[248px]" : "")}>
        {message.kind === "text" && message.text ? <TextBubble text={message.text.text} mine={mine} /> : null}

        {message.kind === "link" && message.link ? (
          <a
            href={message.link.url}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              "max-w-full break-words rounded-[12px] px-3.5 py-2.5 text-[13px] leading-[1.55] shadow-card underline-offset-2 hover:underline",
              mine ? "bg-accent text-white shadow-[0_8px_24px_var(--accent-glow)]" : "border border-border bg-surface text-accent"
            )}
          >
            <span className="block text-[11px] opacity-75">{message.link.host}</span>
            {message.link.url}
          </a>
        ) : null}

        {message.kind === "code" && message.code ? (
          <pre className="max-w-full overflow-x-auto rounded-[12px] border border-border bg-surface px-3.5 py-2.5 text-left font-mono text-[12px] leading-[1.55] text-text shadow-card">
            <code>{message.code.code}</code>
          </pre>
        ) : null}

        {message.kind === "image" && message.asset ? (
          <ImageCard asset={message.asset} status={message.status} progress={message.progress} variant="message" onDownload={canDownload ? () => onDownload?.(message.id) : undefined} />
        ) : null}

        {message.kind === "file" && message.asset ? (
          <FileCard
            asset={message.asset}
            status={message.status}
            progress={message.progress}
            error={message.error?.message}
            speed={transferState?.speed}
            eta={transferState?.eta}
            onPause={canPause ? () => onPause?.(message.id) : undefined}
            onResume={canResume ? () => onResume?.(message.id) : undefined}
            onDownload={canDownload ? () => onDownload?.(message.id) : undefined}
          />
        ) : null}

        {message.kind === "bundle" && message.bundle ? <BundleCard bundle={message.bundle} status={message.status} /> : null}

        {message.kind === "system" ? (
          <div className="max-w-full break-words rounded-pill border border-border bg-surface/80 px-3 py-1.5 text-[11px] text-muted shadow-card backdrop-blur-[8px]">
            {message.text?.text ?? "System update"}
          </div>
        ) : null}

        <div className={clsx("mt-1 flex max-w-full flex-wrap items-center gap-1 text-[10px] text-faint", mine ? "mr-1 justify-end" : "ml-1")}>
          <span>{formatTime(message.createdAt)}</span>
          {mine ? <MessageStatusIcon message={message} /> : null}
          {canPause ? <ActionButton id={`pause-${message.id}`} label="転送を一時停止" icon={<Pause className="h-3 w-3" />} text="一時停止" onClick={() => onPause?.(message.id)} variant="muted" /> : null}
          {canResume ? <ActionButton id={`resume-${message.id}`} label="転送を再開" icon={<Play className="h-3 w-3" />} text="再開" onClick={() => onResume?.(message.id)} variant="accent" /> : null}
          {canDownload ? (
            <ActionButton
              id={`download-${message.id}`}
              label={message.status === "failed" ? "転送を再開" : "ファイルを保存"}
              icon={<Play className="h-3 w-3" />}
              text={message.status === "failed" ? "再開" : "保存"}
              onClick={() => onDownload?.(message.id)}
              variant="accent"
            />
          ) : null}
          {canCancel ? <ActionButton id={`cancel-${message.id}`} label="送信をキャンセル" icon={<X className="h-3 w-3" />} text="取消" onClick={() => onCancel?.(message.id)} variant="muted" /> : null}
          {canRetry ? <ActionButton id={`retry-${message.id}`} label="再送する" icon={<RotateCcw className="h-3 w-3" />} text="再送" onClick={() => onRetry?.(message.id)} variant="danger" /> : null}
        </div>
      </div>
    </div>
  );
}

function TextBubble({ text, mine }: { text: string; mine: boolean }) {
  return (
    <div
      className={clsx(
        "max-w-full break-words rounded-[12px] px-3.5 py-2.5 text-[13px] leading-[1.55] shadow-card",
        mine ? "bg-accent text-white shadow-[0_8px_24px_var(--accent-glow)]" : "border border-border bg-surface text-text dark:bg-surface"
      )}
    >
      {text}
    </div>
  );
}

type ActionButtonProps = {
  id: string;
  label: string;
  icon: ReactNode;
  text: string;
  onClick: () => void;
  variant: "muted" | "accent" | "danger";
};

function ActionButton({ id, label, icon, text, onClick, variant }: ActionButtonProps) {
  const variantClass = {
    muted: "border-border text-muted hover:bg-surface-hover hover:text-text",
    accent: "border-accent/30 text-accent hover:bg-accent-soft",
    danger: "border-danger/30 text-danger hover:bg-red-50 dark:hover:bg-red-950/30"
  }[variant];

  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "kuno-focus-ring ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-pill border bg-surface px-2.5 text-[11px] font-semibold shadow-card transition-all duration-150 active:scale-95",
        variantClass
      )}
    >
      {icon}
      {text}
    </button>
  );
}

function MessageStatusIcon({ message }: { message: ChatMessage }) {
  const status = message.status;
  if (status === "queued" && message.error?.code === "pending_connection") {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">
        <Clock3 className="h-3 w-3" />
        送信待ち
      </span>
    );
  }
  if (status === "sending" || status === "queued") {
    return (
      <span className="inline-flex items-center gap-1 text-faint">
        <Clock3 className="h-3 w-3 animate-pulse" />
        {status === "sending" ? "送信中" : "待機中"}
      </span>
    );
  }
  if (status === "sent") {
    return <Check className="h-3 w-3 text-accent/70" />;
  }
  if (status === "received" || status === "saved") {
    return <CheckCheck className="h-3 w-3 text-accent" />;
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-danger">
        <TriangleAlert className="h-3 w-3" />
        失敗
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-0.5 text-faint">
        <CircleX className="h-3 w-3" />
        取消済み
      </span>
    );
  }
  return null;
}
