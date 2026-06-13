import { X } from "lucide-react";
import { formatBytes } from "../features/chat/format";
import type { DraftAttachment } from "../features/chat/messageTypes";

type AttachmentPreviewProps = {
  attachments: DraftAttachment[];
  onRemove: (id: string) => void;
};

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) {
    return null;
  }

  const visible = attachments.slice(0, 3);
  const remaining = attachments.length - visible.length;

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden border-t border-border bg-white/96 px-3 py-2">
      <div className="kuno-scrollbar flex max-w-full gap-2 overflow-x-auto overflow-y-hidden pb-1">
        {visible.map((attachment) => (
          <div
            key={attachment.id}
            className="relative flex h-[78px] w-[84px] shrink-0 flex-col justify-end rounded-[12px] border border-border bg-white p-2 shadow-card"
          >
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
              className="kuno-focus-ring absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-pill bg-white text-muted shadow-card hover:bg-surface-active hover:text-text"
            >
              <X className="h-3 w-3" />
            </button>
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt="" className="absolute inset-x-2 top-2 h-8 rounded-[7px] object-cover" />
            ) : (
              <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-[7px] bg-red-500 text-[9px] font-bold text-white">
                {attachment.kind === "image" ? "IMG" : "FILE"}
              </span>
            )}
            <span className="max-w-full truncate text-[11px] text-text">{attachment.name}</span>
            <span className="mt-0.5 max-w-full truncate text-[10px] text-faint">{formatBytes(attachment.size)}</span>
          </div>
        ))}
      </div>
      {remaining > 0 ? <div className="mt-1.5 text-[11px] text-faint">+{remaining} more</div> : null}
    </div>
  );
}
