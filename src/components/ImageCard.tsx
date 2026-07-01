import { ExternalLink, ImageIcon, Play, ZoomIn } from "lucide-react";
import clsx from "clsx";
import { formatBytes } from "../features/chat/format";
import type { AssetContent, MessageStatus } from "../features/chat/messageTypes";
import { platformAdapter } from "../features/native/platformAdapter";

type ImageCardProps = {
  asset: AssetContent;
  status: MessageStatus;
  progress?: number;
  variant?: "card" | "message";
  onDownload?: () => void;
};

export function ImageCard({ asset, status, progress, variant = "card", onDownload }: ImageCardProps) {
  const activeProgress = progress ?? asset.progress;
  const messageVariant = variant === "message";
  const isActive = status === "sending" || status === "receiving";
  const isDone = status === "received" || status === "saved";
  const openPath = asset.savePath ?? asset.localPath;
  const localPreviewUrl = platformAdapter.filePreviewUrl(openPath, asset.mime);
  const previewUrl = asset.previewUrl ?? localPreviewUrl ?? asset.thumbnail;
  const isThumbnailOnly = !asset.previewUrl && !localPreviewUrl && Boolean(asset.thumbnail);
  const canOpen = Boolean(openPath) && (status === "sent" || status === "received" || status === "saved");

  const isDownloadPending = status === "queued" && Boolean(onDownload);
  const handleOpen = () => {
    if (openPath) {
      void platformAdapter.openPath(openPath);
    }
  };

  return (
    <div className="group w-full min-w-0 max-w-full overflow-hidden rounded-card border border-border bg-surface shadow-card transition-all duration-200 hover:shadow-window">
      {/* Image preview */}
      <div className="relative aspect-[2.55] overflow-hidden bg-surface-active">
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt={asset.name}
              className={clsx(
                "h-full w-full object-cover transition-all duration-500",
                isActive || isThumbnailOnly ? "scale-[1.02] blur-[8px]" : "scale-100 blur-0"
              )}
            />
            {/* Zoom hint on hover */}
            {canOpen ? (
              <button
                type="button"
                onClick={handleOpen}
                aria-label={`${asset.name} を開く`}
                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/20 group-hover:opacity-100"
              >
                <ZoomIn className="h-6 w-6 text-white drop-shadow-lg" />
              </button>
            ) : null}
          </>
        ) : (
          <div className="grid h-full place-items-center text-faint">
            <ImageIcon className="h-8 w-8 animate-pulse" />
          </div>
        )}

        {/* Overlay download button centered on preview */}
        {isDownloadPending ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] transition-all duration-200">
            <button
              type="button"
              aria-label="画像ダウンロードを開始"
              onClick={onDownload}
              className="kuno-focus-ring flex items-center gap-1.5 rounded-input border border-accent bg-accent px-3.5 py-1.5 text-[11px] font-bold text-white shadow-lg transition-all duration-150 hover:bg-accent-hover hover:scale-105 active:scale-95"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Download ({formatBytes(asset.size)})
            </button>
          </div>
        ) : null}

        {/* Overlay progress during transfer */}
        {isActive && typeof activeProgress === "number" ? (
          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent pb-3 pl-3 pr-3">
            <div className="w-full">
              <div className="mb-1.5 flex justify-between text-[11px] font-medium text-white/90">
                <span>{status === "receiving" ? "受信中..." : "送信中..."}</span>
                <span>{Math.round(activeProgress)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-pill bg-white/30">
                <div
                  className="kuno-progress-shimmer h-full rounded-pill bg-white transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(2, Math.min(100, activeProgress))}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {messageVariant && canOpen ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="min-w-0 truncate text-[11px] text-muted">{asset.name}</span>
          <button
            type="button"
            onClick={handleOpen}
            className="kuno-focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-input px-2 text-[11px] font-semibold text-accent transition-colors hover:bg-accent-soft"
          >
            <ExternalLink className="h-3 w-3" />
            開く
          </button>
        </div>
      ) : null}

      {/* Footer (card variant only) */}
      {!messageVariant ? (
        <div className="px-3 py-2.5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-text">{asset.name}</div>
              <div className="mt-0.5 text-[11px] text-muted">{formatBytes(asset.size)}</div>
            </div>
            <button
              type="button"
              onClick={canOpen ? handleOpen : undefined}
              disabled={!canOpen}
              className="kuno-focus-ring shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-semibold text-accent transition-all duration-150 hover:bg-accent-soft active:scale-95 disabled:text-faint"
            >
              開く
            </button>
          </div>
        </div>
      ) : null}

      {/* Done indicator line */}
      {isDone && messageVariant ? (
        <div className="h-0.5 bg-gradient-to-r from-success/60 to-success" />
      ) : null}
    </div>
  );
}
