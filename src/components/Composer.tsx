import { Paperclip, Plus, SendHorizontal } from "lucide-react";
import clsx from "clsx";
import type { KeyboardEvent } from "react";
import { platformAdapter } from "../features/native/platformAdapter";

type ComposerProps = {
  value: string;
  hasAttachments: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onPickFiles: () => void;
};

export function Composer({ value, hasAttachments, disabled = false, onChange, onSend, onPickFiles }: ComposerProps) {
  const canSend = !disabled && (value.trim().length > 0 || hasAttachments);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      onPickFiles();
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full shrink-0 overflow-hidden border-t border-border bg-white/96 p-3">
      <div
        className="grid min-h-[42px] w-full min-w-0 max-w-full items-end gap-1.5 overflow-hidden rounded-[17px] border border-border bg-white p-1.5 shadow-[0_10px_30px_rgba(16,24,40,0.07)]"
        style={{ gridTemplateColumns: disabled ? "minmax(0, 1fr)" : "minmax(0, 1fr) 32px 32px 36px" }}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Pair first..." : "Message..."}
          disabled={disabled}
          rows={1}
          className="max-h-24 min-h-8 w-full min-w-0 rounded-[12px] border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-5 text-text outline-none transition placeholder:text-faint disabled:text-muted"
        />
        {!disabled ? (
          <>
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              onClick={onPickFiles}
              className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition hover:bg-surface-hover hover:text-text"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Attach from clipboard"
              title="Attach from clipboard"
              onClick={onPickFiles}
              className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted transition hover:bg-surface-hover hover:text-text"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Send"
              title="Send"
              onClick={onSend}
              disabled={!canSend}
              className={clsx(
                "kuno-focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border transition enabled:hover:-translate-y-0.5 active:translate-y-0",
                canSend
                  ? "border-accent bg-accent text-white shadow-[0_8px_18px_rgba(37,99,235,0.28)]"
                  : "border-border bg-surface text-faint shadow-none"
              )}
            >
              <SendHorizontal className="h-4 w-4" />
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
