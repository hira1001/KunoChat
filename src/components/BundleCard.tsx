import { X } from "lucide-react";
import { formatBytes } from "../features/chat/format";
import type { BundleContent, MessageStatus } from "../features/chat/messageTypes";

type BundleCardProps = {
  bundle: BundleContent;
  status: MessageStatus;
};

export function BundleCard({ bundle, status }: BundleCardProps) {
  const title = bundle.caption || buildBundleTitle(bundle);

  return (
    <div className="relative w-full rounded-[12px] border border-border bg-white p-3 shadow-card">
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <span className="grid h-4 min-w-4 place-items-center rounded bg-accent px-1 text-[10px] font-semibold text-white">
          {bundle.count}
        </span>
        <X className="h-3 w-3 text-faint" />
      </div>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-amber-400 text-[9px] font-bold text-white shadow-sm">
          ZIP
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text">{title}</div>
          <div className="mt-1 space-y-1">
            {bundle.items.slice(0, 3).map((item) => (
              <div key={item.id} className="truncate text-[12px] text-muted">
                {item.name}
              </div>
            ))}
            {bundle.items.length > 3 ? (
              <div className="text-[12px] text-faint">+{bundle.items.length - 3} more</div>
            ) : null}
          </div>
          <div className="mt-2 text-[12px] text-muted">
            {bundle.count}ファイル · {formatBytes(bundle.totalSize)}
            {status === "sending" || status === "queued" ? " · 送信中" : ""}
            {status === "failed" ? " · 失敗" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildBundleTitle(bundle: BundleContent): string {
  const firstName = bundle.items[0]?.name;
  if (!firstName) {
    return `${bundle.count} files`;
  }
  return bundle.count > 1 ? `${firstName} ほか${bundle.count - 1}件` : firstName;
}
