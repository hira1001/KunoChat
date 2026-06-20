import type { ChatMessage, ConnectionStatus } from "../features/chat/messageTypes";
import { MessageBubble } from "./MessageBubble";
import { useEffect, useRef } from "react";
import { MessageSquareDashed, Wifi } from "lucide-react";

type MessageListProps = {
  messages: ChatMessage[];
  connectionStatus: ConnectionStatus;
  peerName: string;
  showTyping?: boolean;
  onRetryMessage?: (messageId: string) => void;
  onCancelMessage?: (messageId: string) => void;
  onPauseMessage?: (messageId: string) => void;
  onResumeMessage?: (messageId: string) => void;
  onDownload?: (messageId: string) => void;
};

export function MessageList({
  messages,
  connectionStatus,
  peerName,
  showTyping = false,
  onRetryMessage,
  onCancelMessage,
  onPauseMessage,
  onResumeMessage,
  onDownload
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = connectionStatus === "connected";

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, showTyping]);

  return (
    <div
      ref={scrollRef}
      id="message-list"
      className="kuno-scrollbar flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-3.5 py-4"
    >
      {/* Date chip */}
      <div className="flex justify-center">
        <span className="rounded-pill border border-border bg-surface px-3 py-1 text-[11px] font-medium text-faint shadow-card">
          Today
        </span>
      </div>

      {messages.length === 0 ? (
        <EmptyState isConnected={isConnected} />
      ) : (
        <>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onRetry={onRetryMessage}
              onCancel={onCancelMessage}
              onPause={onPauseMessage}
              onResume={onResumeMessage}
              onDownload={onDownload}
            />
          ))}
          {showTyping ? <TypingIndicator peerName={peerName} /> : null}
        </>
      )}
    </div>
  );
}

function EmptyState({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="flex w-full min-w-0 flex-1 items-center justify-center px-2 text-center">
      <div className="kuno-fade-in mx-auto w-full max-w-[280px] overflow-hidden rounded-[16px] border border-border bg-surface/60 px-5 py-6 shadow-card backdrop-blur-[8px]">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft">
          {isConnected ? (
            <MessageSquareDashed className="h-6 w-6 text-accent" />
          ) : (
            <Wifi className="h-6 w-6 text-faint" />
          )}
        </div>
        <div className="mt-3 text-[14px] font-semibold tracking-[-0.02em] text-text">
          {isConnected ? "何か送ってみましょう" : "相手のPCとペアリング"}
        </div>
        <div className="mx-auto mt-1.5 max-w-[220px] text-[12px] leading-[1.6] text-muted">
          {isConnected
            ? "テキストを入力するか、ファイルをここにドロップしてください。"
            : "接続が確立するまで、本文やファイルは外部へ送信されません。"}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator({ peerName }: { peerName: string }) {
  const initial = peerName.trim().charAt(0).toUpperCase() || "K";

  return (
    <div className="kuno-message-enter flex w-full min-w-0 items-center gap-2.5">
      {/* Peer avatar */}
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-[10px] font-bold text-muted shadow-card">
        {initial}
      </div>
      {/* Dot indicator */}
      <div className="flex h-9 min-w-0 items-center gap-1.5 rounded-[15px] border border-border bg-surface px-3.5 shadow-card">
        <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-muted" />
        <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-muted" />
        <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-muted" />
        <span className="ml-1.5 truncate text-[11px] text-muted">入力中...</span>
      </div>
    </div>
  );
}
