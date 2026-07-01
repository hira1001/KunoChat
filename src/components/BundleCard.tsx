import { ExternalLink, Files, FolderOpen } from "lucide-react";
import clsx from "clsx";
import { formatBytes } from "../features/chat/format";
import type { BundleContent, MessageStatus } from "../features/chat/messageTypes";
import { platformAdapter } from "../features/native/platformAdapter";

type BundleCardProps = {
  bundle: BundleContent;
  status: MessageStatus;
};

export function BundleCard({ bundle, status }: BundleCardProps) {
  const title = bundle.caption || buildBundleTitle(bundle);
  const isSending = status === "sending" || status === "queued";
  const isDone = status === "received" || status === "saved";
  const failed = status === "failed";

  return (
    <div
      className={clsx(
        "relative w-full min-w-0 max-w-full overflow-hidden rounded-card border bg-surface p-3 shadow-card transition-all duration-300",
        isDone ? "border-success/30" : failed ? "border-danger/30" : "border-border"
      )}
    >
      {/* Count badge */}
      <div className="absolute right-2.5 top-2.5 flex items-center gap-1">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white shadow-accent">
          {bundle.count}
        </span>
      </div>

      <div className="flex min-w-0 items-start gap-3 pr-8">
        {/* Bundle icon */}
        <div className={clsx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-[7px] text-white shadow-sm transition-all duration-200",
          isSending ? "animate-pulse bg-amber-500" : isDone ? "bg-green-600" : failed ? "bg-red-500" : "bg-amber-500"
        )}>
          <Files className="h-5 w-5" />
        </div>

        {/* Bundle info */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-text">{title}</div>
          <div className="mt-1.5 space-y-0.5">
            {bundle.items.slice(0, 3).map((item) => {
              const openPath = item.savePath ?? item.localPath;
              return (
                <div key={item.id} className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-faint" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {openPath && (status === "sent" || isDone) ? (
                    <button
                      type="button"
                      aria-label={`${item.name} を開く`}
                      onClick={() => void platformAdapter.openPath(openPath)}
                      className="kuno-focus-ring grid h-5 w-5 shrink-0 place-items-center rounded-full text-accent transition-colors hover:bg-accent-soft"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {bundle.items.length > 3 ? (
              <div className="text-[11px] text-faint">+{bundle.items.length - 3} 件</div>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="text-muted">{bundle.count}ファイル · {formatBytes(bundle.totalSize)}</span>
            {isSending ? <span className="font-medium text-accent">送信中...</span> : null}
            {failed ? <span className="font-medium text-danger">失敗</span> : null}
            {isDone ? <span className="font-medium text-success">完了</span> : null}
            {bundle.items.some((item) => item.savePath ?? item.localPath) && (status === "sent" || isDone) ? (
              <button
                type="button"
                onClick={() => {
                  const firstItem = bundle.items.find((item) => item.savePath ?? item.localPath);
                  const path = firstItem?.savePath ?? firstItem?.localPath;
                  if (path) {
                    void platformAdapter.revealPath(path);
                  }
                }}
                className="kuno-focus-ring ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-input px-2 text-[11px] font-semibold text-accent transition-colors hover:bg-accent-soft"
              >
                <FolderOpen className="h-3 w-3" />
                場所
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildBundleTitle(bundle: BundleContent): string {
  const firstName = bundle.items[0]?.name;
  if (!firstName) return `${bundle.count} files`;
  return bundle.count > 1 ? `${firstName} ほか${bundle.count - 1}件` : firstName;
}
