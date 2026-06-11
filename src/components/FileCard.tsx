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
  const label = fileLabel(asset.name, asset.mime);
  const color = labelColor(label);

  return (
    <div className="w-full rounded-[12px] border border-border bg-white p-3 shadow-card">
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[9px] font-bold text-white shadow-sm",
            color
          )}
        >
          {label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text">{asset.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
            <span>{formatBytes(asset.size)}</span>
            {status === "sending" ? <span>· 送信中...</span> : null}
            {failed ? <span className="text-danger">· {error ?? "送信失敗"}</span> : null}
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
              className="h-full rounded-pill bg-accent transition-all duration-150"
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
    return "bg-amber-400";
  }
  if (label === "FIG") {
    return "bg-violet-500";
  }
  if (label === "IMG") {
    return "bg-blue-500";
  }
  return "bg-slate-500";
}
