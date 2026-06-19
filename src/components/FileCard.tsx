import { AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { fileLabel, formatBytes } from "../features/chat/format";
import type { AssetContent, MessageStatus } from "../features/chat/messageTypes";

type FileCardProps = {
  asset: AssetContent;
  status: MessageStatus;
  progress?: number;
  error?: string;
};

export function FileCard({ asset, status, progress, error }: FileCardProps) {
  const activeProgress = progress ?? asset.progress;
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const verified = Boolean(asset.sha256 && (status === "received" || status === "saved"));
  const label = fileLabel(asset.name, asset.mime);
  const color = labelColor(label);

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[13px] border border-border bg-white p-3 shadow-card">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-[9px] text-[9px] font-bold text-white shadow-sm",
            color
          )}
        >
          {label}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[13px] font-semibold text-text">{asset.name}</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
            <span>{formatBytes(asset.size)}</span>
            {verified ? <span className="text-success">検証済み</span> : null}
            {status === "sending" ? <span>送信中...</span> : null}
            {failed ? <span className="break-words text-danger">{error ?? "送信失敗"}</span> : null}
            {cancelled ? <span className="text-faint">キャンセル済み</span> : null}
          </div>
        </div>
        {failed ? <AlertTriangle className="h-4 w-4 text-danger" /> : null}
      </div>

      {(status === "sending" || status === "receiving") && typeof activeProgress === "number" ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-end text-[11px] text-muted">
            <span>{Math.round(activeProgress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-pill bg-surface-active">
            <div
              className="h-full rounded-pill bg-accent transition-all duration-150 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, activeProgress))}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function labelColor(label: string): string {
  if (label === "PDF" || label === "MP4" || label === "VID") {
    return "bg-red-500";
  }
  if (label === "ZIP") {
    return "bg-amber-500";
  }
  if (label === "FIG") {
    return "bg-violet-500";
  }
  if (label === "IMG") {
    return "bg-blue-500";
  }
  return "bg-slate-500";
}
