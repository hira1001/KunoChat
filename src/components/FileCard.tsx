import { AlertTriangle, CheckCircle2, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { fileLabel, formatBytes } from "../features/chat/format";
import type { AssetContent, MessageStatus } from "../features/chat/messageTypes";

type FileCardProps = {
  asset: AssetContent;
  status: MessageStatus;
  progress?: number;
  error?: string;
  onPause?: () => void;
  onResume?: () => void;
};

export function FileCard({ asset, status, progress, error, onPause, onResume }: FileCardProps) {
  const activeProgress = progress ?? asset.progress;
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const isSending = status === "sending";
  const isReceiving = status === "receiving";
  const isPaused = status === "queued";
  const isActive = isSending || isReceiving;
  const isDone = status === "received" || status === "saved";
  const verified = Boolean(asset.sha256 && isDone);
  const label = fileLabel(asset.name, asset.mime);
  const color = labelColor(label);

  return (
    <div
      className={clsx(
        "w-full min-w-0 max-w-full overflow-hidden rounded-[13px] border bg-surface p-3 shadow-card transition-all duration-300",
        isDone
          ? "border-success/30 kuno-success-flash"
          : failed
          ? "border-danger/30"
          : "border-border"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* File type badge */}
        <div
          className={clsx(
            "relative grid h-10 w-10 shrink-0 place-items-center rounded-[9px] text-[9px] font-bold text-white shadow-sm transition-transform duration-200",
            color,
            isActive && "animate-pulse"
          )}
        >
          {label}
        </div>

        {/* File info */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-text">{asset.name}</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <span>{formatBytes(asset.size)}</span>
            {verified ? (
              <span className="flex items-center gap-0.5 text-success">
                <CheckCircle2 className="h-3 w-3" />
                検証済み
              </span>
            ) : null}
            {isSending ? <span className="text-accent">送信中...</span> : null}
            {isReceiving ? <span className="text-accent">受信中...</span> : null}
            {isPaused ? <span className="text-warning">一時停止中</span> : null}
            {failed ? <span className="break-words text-danger">{error ?? "送信失敗"}</span> : null}
            {cancelled ? <span className="text-faint">キャンセル済み</span> : null}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {onPause && isActive ? (
            <button
              type="button"
              aria-label="転送を一時停止"
              onClick={onPause}
              className="kuno-focus-ring grid h-7 w-7 place-items-center rounded-full border border-border bg-surface-hover text-muted transition-all duration-150 hover:border-warning hover:text-warning active:scale-90"
            >
              <Pause className="h-3 w-3" />
            </button>
          ) : null}
          {onResume && isPaused ? (
            <button
              type="button"
              aria-label="転送を再開"
              onClick={onResume}
              className="kuno-focus-ring grid h-7 w-7 place-items-center rounded-full border border-accent/30 bg-accent-soft text-accent transition-all duration-150 hover:bg-accent hover:text-white active:scale-90"
            >
              <Play className="h-3 w-3" />
            </button>
          ) : null}
          {failed ? <AlertTriangle className="h-4 w-4 text-danger" /> : null}
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || isPaused) && typeof activeProgress === "number" ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className={clsx("font-medium", isPaused ? "text-warning" : "text-accent")}>
              {isPaused ? "一時停止中" : isReceiving ? "受信中" : "送信中"}
            </span>
            <span className="tabular-nums text-muted">{Math.round(activeProgress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-pill bg-surface-active">
            <div
              className={clsx(
                "kuno-progress-shimmer h-full rounded-pill transition-all duration-300 ease-out",
                isPaused
                  ? "bg-warning/60"
                  : "bg-gradient-to-r from-accent via-blue-400 to-accent-hover"
              )}
              style={{ width: `${Math.max(2, Math.min(100, activeProgress))}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Completion line */}
      {isDone ? (
        <div className="mt-2.5 h-1 overflow-hidden rounded-pill bg-success/20">
          <div className="h-full w-full rounded-pill bg-success transition-all duration-500" />
        </div>
      ) : null}
    </div>
  );
}

function labelColor(label: string): string {
  const map: Record<string, string> = {
    PDF: "bg-red-500",
    MP4: "bg-red-500",
    VID: "bg-red-600",
    ZIP: "bg-amber-500",
    FIG: "bg-violet-500",
    IMG: "bg-blue-500",
    DOC: "bg-blue-600",
    XLS: "bg-green-600",
    PPT: "bg-orange-500"
  };
  return map[label] ?? "bg-slate-500";
}
