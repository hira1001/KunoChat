import { ExternalLink, ImageIcon, Play, X, ZoomIn } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";
import { formatBytes } from "../features/chat/format";
import type { AssetContent, MessageStatus } from "../features/chat/messageTypes";
import { platformAdapter } from "../features/native/platformAdapter";
import { useLocalImagePreview } from "./useLocalImagePreview";

type ImageCardProps = {
  asset: AssetContent;
  status: MessageStatus;
  progress?: number;
  variant?: "card" | "message";
  onDownload?: () => void;
};

export function ImageCard({ asset, status, progress, variant = "card", onDownload }: ImageCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  // Set when the chosen preview URL fails to load (e.g. a dead blob URL after a
  // restart). We then fall back to the on-disk file via convertFileSrc.
  const [previewBroken, setPreviewBroken] = useState(false);
  const activeProgress = progress ?? asset.progress;
  const messageVariant = variant === "message";
  const isActive = status === "sending" || status === "receiving";
  const isDone = status === "received" || status === "saved";
  const openPath = asset.savePath ?? asset.localPath;
  const localPreviewUrl = useLocalImagePreview(openPath, asset.mime);
  const storedPreviewUrl = asset.previewUrl?.startsWith("blob:") && openPath ? undefined : asset.previewUrl;
  const fileFallbackUrl = openPath ? platformAdapter.filePreviewUrl(openPath, asset.mime) : undefined;
  const previewUrl = previewBroken
    ? fileFallbackUrl
    : localPreviewUrl ?? storedPreviewUrl ?? asset.thumbnail;
  const handlePreviewError = () => {
    if (!previewBroken && fileFallbackUrl && previewUrl !== fileFallbackUrl) {
      setPreviewBroken(true);
    }
  };
  const isThumbnailOnly = !localPreviewUrl && !storedPreviewUrl && Boolean(asset.thumbnail);
  const canOpen = Boolean(openPath) && (status === "sent" || status === "received" || status === "saved");
  const isDownloadPending = status === "queued" && Boolean(onDownload);

  const handleOpen = () => {
    if (openPath) {
      void platformAdapter.openPath(openPath);
    }
  };

  return (
    <div className="group w-full min-w-0 max-w-full overflow-hidden rounded-card border border-border bg-surface shadow-card transition-all duration-200 hover:shadow-window">
      <div className="relative flex min-h-[132px] max-h-[320px] items-center justify-center overflow-hidden bg-surface-active">
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt={asset.name}
              onError={handlePreviewError}
              onClick={() => {
                if (!isActive) setPreviewOpen(true);
              }}
              className={clsx(
                "max-h-[320px] w-full object-contain transition-all duration-500",
                !isActive && "cursor-zoom-in",
                isActive || isThumbnailOnly ? "scale-[1.02] blur-[8px]" : "scale-100 blur-0"
              )}
            />
            {!isActive ? (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                aria-label={`${asset.name}を拡大`}
                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/20 group-hover:opacity-100"
              >
                <ZoomIn className="h-6 w-6 text-white drop-shadow-lg" />
              </button>
            ) : null}
          </>
        ) : (
          <div className="grid h-full min-h-[132px] place-items-center text-faint">
            <ImageIcon className="h-8 w-8 animate-pulse" />
          </div>
        )}

        {isDownloadPending ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] transition-all duration-200">
            <button
              type="button"
              aria-label="画像のダウンロードを開始"
              onClick={onDownload}
              className="kuno-focus-ring flex items-center gap-1.5 rounded-input border border-accent bg-accent px-3.5 py-1.5 text-[11px] font-bold text-white shadow-lg transition-all duration-150 hover:scale-105 hover:bg-accent-hover active:scale-95"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              ダウンロード ({formatBytes(asset.size)})
            </button>
          </div>
        ) : null}

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

      {!messageVariant ? (
        <div className="px-3 py-2.5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate text-[13px] font-semibold text-text">{asset.name}</div>
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

      {isDone && messageVariant ? <div className="h-0.5 bg-gradient-to-r from-success/60 to-success" /> : null}

      {previewOpen && previewUrl ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={asset.name}>
          <div className="flex h-12 shrink-0 items-center gap-2 px-3 text-white">
            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{asset.name}</div>
            {canOpen ? (
              <button
                type="button"
                onClick={handleOpen}
                className="kuno-focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-input bg-white/10 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                開く
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              aria-label="プレビューを閉じる"
              className="kuno-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={() => setPreviewOpen(false)} className="grid min-h-0 flex-1 place-items-center p-3">
            <img src={previewUrl} alt={asset.name} onError={handlePreviewError} className="max-h-full max-w-full object-contain shadow-2xl" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
