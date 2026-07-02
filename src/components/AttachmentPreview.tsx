import { X } from "lucide-react";
import clsx from "clsx";
import { formatBytes } from "../features/chat/format";
import type { DraftAttachment } from "../features/chat/messageTypes";
import { useLocalImagePreview } from "./useLocalImagePreview";

type AttachmentPreviewProps = {
  attachments: DraftAttachment[];
  onRemove: (id: string) => void;
};

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) {
    return null;
  }

  const visible = attachments.slice(0, 4);
  const remaining = attachments.length - visible.length;

  return (
    <div className="kuno-fade-in w-full min-w-0 max-w-full overflow-hidden border-t border-border bg-bg-glass px-3 py-2.5 backdrop-blur-[16px]">
      <div className="kuno-scrollbar flex max-w-full gap-2 overflow-x-auto overflow-y-hidden pb-1">
        {visible.map((attachment) => (
          <AttachmentPreviewItem key={attachment.id} attachment={attachment} onRemove={onRemove} />
        ))}

        {remaining > 0 ? (
          <div className="flex h-[84px] w-[88px] shrink-0 items-center justify-center rounded-card border border-dashed border-border bg-surface text-[12px] font-semibold text-muted">
            +{remaining}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type AttachmentPreviewItemProps = {
  attachment: DraftAttachment;
  onRemove: (id: string) => void;
};

function AttachmentPreviewItem({ attachment, onRemove }: AttachmentPreviewItemProps) {
  const localPreviewUrl = useLocalImagePreview(attachment.localPath, attachment.mime, attachment.kind === "image");
  const previewUrl = localPreviewUrl ?? attachment.previewUrl;

  return (
    <div className="kuno-message-enter group relative flex h-[84px] w-[88px] shrink-0 flex-col justify-end overflow-hidden rounded-card border border-border bg-surface shadow-card transition-all duration-200 hover:border-border-strong hover:shadow-window">
      <button
        type="button"
        aria-label={`${attachment.name}を削除`}
        onClick={() => onRemove(attachment.id)}
        className="kuno-focus-ring absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-muted shadow-card backdrop-blur-sm transition-all duration-150 hover:bg-danger hover:text-white active:scale-90 dark:bg-surface"
      >
        <X className="h-3 w-3" />
      </button>

      {previewUrl ? (
        <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div
          className={clsx(
            "absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-[7px] text-[9px] font-bold text-white",
            attachment.kind === "image" ? "bg-blue-500" : "bg-slate-500"
          )}
        >
          {attachment.kind === "image" ? "IMG" : "FILE"}
        </div>
      )}

      <div className="relative z-10 bg-gradient-to-t from-black/50 to-transparent px-2 pb-2 pt-4">
        <span className="block max-w-full truncate text-[10px] font-medium text-white drop-shadow">{attachment.name}</span>
        <span className="block max-w-full truncate text-[9px] text-white/70 drop-shadow">{formatBytes(attachment.size)}</span>
      </div>
    </div>
  );
}
