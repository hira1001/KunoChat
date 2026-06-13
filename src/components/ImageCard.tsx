import { ImageIcon } from "lucide-react";
import { formatBytes } from "../features/chat/format";
import type { AssetContent, MessageStatus } from "../features/chat/messageTypes";

type ImageCardProps = {
  asset: AssetContent;
  status: MessageStatus;
  progress?: number;
  variant?: "card" | "message";
};

export function ImageCard({ asset, status, progress, variant = "card" }: ImageCardProps) {
  const activeProgress = progress ?? asset.progress;
  const messageVariant = variant === "message";

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[13px] border border-border bg-white shadow-card">
      <div className="aspect-[2.55] bg-surface">
        {asset.previewUrl ? (
          <img src={asset.previewUrl} alt={asset.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-faint">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </div>
      {!messageVariant ? (
        <div className="px-3 py-2.5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate text-[13px] font-semibold text-text">{asset.name}</div>
              <div className="mt-0.5 text-[11px] text-muted">{formatBytes(asset.size)}</div>
            </div>
            <button className="kuno-focus-ring shrink-0 rounded-pill px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-hover">
              Open
            </button>
          </div>
          {(status === "sending" || status === "receiving") && typeof activeProgress === "number" ? (
            <div className="mt-3 h-1 overflow-hidden rounded-pill bg-surface-active">
              <div className="h-full rounded-pill bg-accent" style={{ width: `${activeProgress}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {messageVariant && (status === "sending" || status === "receiving") && typeof activeProgress === "number" ? (
        <div className="h-1 overflow-hidden bg-surface-active">
          <div className="h-full bg-accent" style={{ width: `${activeProgress}%` }} />
        </div>
      ) : null}
    </div>
  );
}
