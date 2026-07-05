import { useLayoutEffect, useRef } from "react";
import { MessageSquareDashed, Wifi } from "lucide-react";
import type { ChatMessage, ConnectionStatus } from "../features/chat/messageTypes";
import { MessageBubble } from "./MessageBubble";

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
  onPair?: () => void;
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
  onDownload,
  onPair
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const isConnected = connectionStatus === "connected";
  const hasContent = messages.length > 0 || showTyping;

  useLayoutEffect(() => {
    if (!scrollRef.current || !shouldStickToBottomRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
  }, [messages.length, showTyping]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    shouldStickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 72;
  }

  return (
    <div
      ref={scrollRef}
      id="message-list"
      onScroll={handleScroll}
      className="kuno-scrollbar flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-3.5 py-4"
    >
      {hasContent ? (
        <div className="flex justify-center">
          <span className="rounded-pill bg-surface-hover px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
            Today
          </span>
        </div>
      ) : null}

      {messages.length === 0 && !showTyping ? (
        <EmptyState isConnected={isConnected} onPair={onPair} />
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

function EmptyState({ isConnected, onPair }: { isConnected: boolean; onPair?: () => void }) {
  return (
    <div className="flex w-full min-w-0 flex-1 items-center justify-center px-2 text-center">
      <div className="kuno-fade-in mx-auto w-full max-w-[280px] px-5 py-6">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-card border border-accent/10 bg-accent-soft">
          {isConnected ? <MessageSquareDashed className="h-6 w-6 text-accent" /> : <Wifi className="h-6 w-6 text-faint" />}
        </div>
        <div className="mt-3 text-[15px] font-semibold text-text">{isConnected ? "何か送ってみましょう" : "未接続でも送信待ちにできます"}</div>
        <div className="mx-auto mt-1.5 max-w-[220px] text-[12px] leading-[1.6] text-muted">
          {isConnected
            ? "テキストを入力するか、ファイルをここにドロップしてください。"
            : "メッセージやファイルはこのPCに保存され、相手を選ぶと自動送信されます。"}
        </div>
        {!isConnected && onPair ? (
          <button
            type="button"
            onClick={onPair}
            className="kuno-focus-ring mt-4 h-8 rounded-input bg-accent px-3 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            接続先を選ぶ
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TypingIndicator({ peerName }: { peerName: string }) {
  const initial = peerName.trim().charAt(0).toUpperCase() || "K";

  return (
    <div className="kuno-message-enter flex w-full min-w-0 items-center gap-2.5" role="status" aria-live="polite" aria-label={`${peerName} is typing`}>
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-[10px] font-bold text-muted shadow-card">
        {initial}
      </div>
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-pill border border-border bg-surface px-3 shadow-card">
        <span className="truncate text-[11px] font-medium text-muted">{peerName}</span>
        <span className="shrink-0 text-[11px] text-faint">入力中</span>
        <span className="ml-0.5 flex shrink-0 items-center gap-1" aria-hidden="true">
          <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="kuno-dot-pulse h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
      </div>
    </div>
  );
}
