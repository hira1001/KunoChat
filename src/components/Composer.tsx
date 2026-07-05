import { Plus, SendHorizontal } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ConnectionStatus } from "../features/chat/messageTypes";
import { platformAdapter } from "../features/native/platformAdapter";

type ComposerProps = {
  value: string;
  hasAttachments: boolean;
  connectionStatus: ConnectionStatus;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onPickFiles: () => void;
  onBlur?: () => void;
};

export function Composer({
  value,
  hasAttachments,
  connectionStatus,
  disabled = false,
  onChange,
  onSend,
  onPickFiles,
  onBlur
}: ComposerProps) {
  const canSend = !disabled && (value.trim().length > 0 || hasAttachments);
  const queuesOffline = connectionStatus !== "connected";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      if (canSend) onSend();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      onPickFiles();
    }
  }

  function handleSend() {
    if (!canSend) return;
    const button = document.getElementById("composer-send-btn");
    button?.classList.remove("kuno-send-bounce");
    void button?.offsetWidth;
    button?.classList.add("kuno-send-bounce");
    onSend();
  }

  return (
    <div className="w-full min-w-0 max-w-full shrink-0 overflow-hidden border-t border-border bg-bg-glass px-3 py-3 backdrop-blur-[20px]">
      {queuesOffline && !disabled ? (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-2 rounded-input bg-surface px-2.5 py-1 text-[10px] text-muted">
          <span className="min-w-0 truncate">オフライン送信: 相手が戻るまで送信待ちに保存します</span>
          <span className="shrink-0 font-semibold text-accent">送信OK</span>
        </div>
      ) : null}
      <div
        className={clsx(
          "grid min-h-[44px] w-full min-w-0 max-w-full items-end gap-1.5 overflow-hidden rounded-input border bg-surface p-1.5 transition-all duration-200",
          disabled
            ? "border-border"
            : "border-border-strong shadow-[0_4px_20px_rgba(14,21,40,0.08)] focus-within:border-accent/40 focus-within:shadow-[0_6px_24px_rgba(37,99,235,0.14)]"
        )}
        style={{ gridTemplateColumns: disabled ? "minmax(0, 1fr)" : "minmax(0, 1fr) 32px 36px" }}
      >
        <textarea
          id="composer-textarea"
          ref={textareaRef}
          aria-label="メッセージ"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          placeholder={disabled ? "まずはペアリングしてください..." : queuesOffline ? "オフラインでも送信待ちにできます" : "メッセージを入力..."}
          disabled={disabled}
          rows={1}
          aria-keyshortcuts="Enter"
          className="max-h-28 min-h-8 w-full min-w-0 resize-none rounded-[6px] border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-5 text-text outline-none placeholder:text-faint disabled:text-muted"
        />
        {!disabled ? (
          <>
            <button
              type="button"
              id="composer-pick-btn"
              aria-label="ファイルを選択"
              title="ファイルを選択"
              onClick={onPickFiles}
              className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-all duration-150 hover:bg-surface-active hover:text-text active:scale-90"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              id="composer-send-btn"
              aria-label={queuesOffline ? "送信待ちに追加" : "送信"}
              title={queuesOffline ? "送信待ちに追加 (Enter)" : "送信 (Enter)"}
              onClick={handleSend}
              disabled={!canSend}
              className={clsx(
                "kuno-focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all duration-200",
                canSend
                  ? "border-accent/30 bg-accent text-white shadow-accent hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-[0_10px_28px_var(--accent-glow)] active:translate-y-0 active:scale-95"
                  : "border-border bg-surface text-faint shadow-none"
              )}
            >
              <SendHorizontal className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export async function pickFilesIntoComposer(onFiles: (files: Awaited<ReturnType<typeof platformAdapter.pickFiles>>) => void) {
  const files = await platformAdapter.pickFiles();
  onFiles(files);
}
