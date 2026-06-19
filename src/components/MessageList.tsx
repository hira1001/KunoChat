import type { ChatMessage, ConnectionStatus } from "../features/chat/messageTypes";
import { MessageBubble } from "./MessageBubble";
import { useEffect, useRef } from "react";

type MessageListProps = {
  messages: ChatMessage[];
  connectionStatus: ConnectionStatus;
  peerName: string;
  showTyping?: boolean;
  onRetryMessage?: (messageId: string) => void;
};

export function MessageList({ messages, connectionStatus, peerName, showTyping = false, onRetryMessage }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, showTyping]);

  return (
    <div
      ref={scrollRef}
      className="kuno-scrollbar flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-3.5 py-4"
    >
      <div className="mx-auto rounded-pill border border-border bg-white/90 px-2.5 py-1 text-[11px] font-medium text-faint shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        Today
      </div>
      {messages.length === 0 ? (
        <div className="flex w-full min-w-0 flex-1 items-center justify-center px-2 text-center">
          <div
            className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[14px] border border-border bg-white/78 px-5 py-4 shadow-card"
          >
            <div className="truncate text-[14px] font-semibold text-text">
              {connectionStatus === "connected" ? "Drop something here" : "Pair your second PC"}
            </div>
            <div className="mx-auto mt-1 max-w-[240px] break-words text-[12px] leading-5 text-muted">
              {connectionStatus === "connected"
                ? "またはメッセージを送信"
                : "接続が確立するまで、本文やファイルはこの端末から外へ送信されません。"}
            </div>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message) => <MessageBubble key={message.id} message={message} onRetry={onRetryMessage} />)}
          {showTyping ? <TypingIndicator peerName={peerName} /> : null}
        </>
      )}
    </div>
  );
}

function TypingIndicator({ peerName }: { peerName: string }) {
  const initial = peerName.trim().charAt(0).toUpperCase() || "K";

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-white text-[10px] font-semibold text-muted shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        {initial}
      </div>
      <div className="flex h-8 min-w-0 items-center gap-1 rounded-[15px] border border-border bg-white px-3 shadow-card">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:240ms]" />
        <span className="ml-1 truncate text-[11px] text-muted">入力中...</span>
      </div>
    </div>
  );
}
