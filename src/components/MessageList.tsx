import type { ChatMessage, ConnectionStatus } from "../features/chat/messageTypes";
import { MessageBubble } from "./MessageBubble";
import { useEffect, useRef } from "react";

type MessageListProps = {
  messages: ChatMessage[];
  connectionStatus: ConnectionStatus;
  peerName: string;
  showTyping?: boolean;
};

export function MessageList({ messages, connectionStatus, peerName, showTyping = false }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, showTyping]);

  return (
    <div ref={scrollRef} className="kuno-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      <div className="mx-auto rounded-pill border border-border bg-white px-2.5 py-1 text-[11px] text-faint">
        Today
      </div>
      {messages.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <div className="text-[14px] font-medium text-text">
              {connectionStatus === "connected" ? "Drop something here" : "Pair your second PC"}
            </div>
            <div className="mt-1 max-w-[240px] text-[12px] leading-5 text-muted">
              {connectionStatus === "connected"
                ? "またはメッセージを送信"
                : "接続が確立するまで、本文やファイルはこの端末から外へ送信されません。"}
            </div>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          {showTyping ? <TypingIndicator peerName={peerName} /> : null}
        </>
      )}
    </div>
  );
}

function TypingIndicator({ peerName }: { peerName: string }) {
  const initial = peerName.trim().charAt(0).toUpperCase() || "K";

  return (
    <div className="flex items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-400">
        {initial}
      </div>
      <div className="flex h-8 items-center gap-1 rounded-[15px] border border-border bg-white px-3 shadow-card">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
        <span className="ml-1 text-[11px] text-muted">入力中...</span>
      </div>
    </div>
  );
}
