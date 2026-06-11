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
    <div className="flex min-h-[56px] shrink-0 items-center gap-1.5 border-t border-border bg-white p-3">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Pair first..." : "Message..."}
        disabled={disabled}
        rows={1}
        className="max-h-24 min-h-9 flex-1 rounded-[12px] border border-border bg-white px-3 py-2 text-[13px] leading-5 text-text outline-none transition placeholder:text-faint focus:border-border-strong focus:bg-white disabled:bg-surface disabled:text-muted"
      />
      <button
        type="button"
        aria-label="Attach files"
        title="Attach files"
        onClick={onPickFiles}
        disabled={disabled}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-pill text-slate-500 transition enabled:hover:bg-surface-hover enabled:hover:text-text disabled:text-faint"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Attach from clipboard"
        title="Attach from clipboard"
        onClick={onPickFiles}
        disabled={disabled}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-pill text-slate-500 transition enabled:hover:bg-surface-hover enabled:hover:text-text disabled:text-faint"
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
          "grid h-9 w-9 shrink-0 place-items-center rounded-full border transition enabled:hover:-translate-y-0.5",
          canSend
            ? "border-accent bg-accent text-white shadow-[0_8px_18px_rgba(37,99,235,0.28)]"
            : "border-border bg-surface text-faint shadow-none"
        )}
      >
        <SendHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}

export async function pickFilesIntoComposer(onFiles: (files: Awaited<ReturnType<typeof platformAdapter.pickFiles>>) => void) {
  const files = await platformAdapter.pickFiles();
  onFiles(files);
}
