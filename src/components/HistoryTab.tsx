import { useEffect, useState } from "react";
import { useChatStore } from "../features/chat/chatStore";
import { formatBytes } from "../features/chat/format";
import { platformAdapter } from "../features/native/platformAdapter";
import { Folder, FileText, Download, Upload, ExternalLink, Trash2, ArrowLeft, Search, CheckCircle, AlertCircle, XCircle } from "lucide-react";

export function HistoryTab() {
  const { history, loadHistory, clearHistoryList, setView } = useChatStore();
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filtered = history.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(timestamp);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-text">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-glass px-4 backdrop-blur-[20px]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView("main")}
            className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-full hover:bg-surface-hover active:scale-95 transition-all duration-150"
            aria-label="戻る"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[14px] font-bold tracking-tight">転送履歴</h1>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={() => void clearHistoryList()}
            className="kuno-focus-ring flex items-center gap-1.5 rounded-pill border border-danger/30 bg-surface px-2.5 py-1 text-[11px] font-semibold text-danger transition-all duration-150 hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-95"
          >
            <Trash2 className="h-3 w-3" />
            履歴を消去
          </button>
        )}
      </div>

      {/* Search Bar */}
      {history.length > 0 && (
        <div className="p-3 shrink-0 border-b border-border bg-surface/30">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-faint" />
            <input
              type="text"
              placeholder="ファイル名で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="kuno-focus-ring w-full rounded-input border border-border bg-surface py-2 pl-9 pr-4 text-[13px] outline-none transition-all duration-150 placeholder:text-faint focus:border-accent"
            />
          </div>
        </div>
      )}

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full border border-border bg-surface-hover text-faint shadow-card">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-[14px] font-bold text-text">履歴がありません</h2>
            <p className="mt-1 max-w-[200px] text-[11px] leading-relaxed text-muted">
              {search ? "一致するファイルが見つかりません。" : "送信または受信したファイルがここに表示されます。"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="group flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-card transition-all duration-200 hover:border-border-strong hover:shadow-window"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {/* Direction & Type Icon */}
                  <div className="relative shrink-0">
                    <div className="grid h-9 w-9 place-items-center rounded-card bg-surface-active text-muted shadow-sm">
                      {item.isFolder ? (
                        <Folder className="h-4 w-4 text-amber-500 fill-amber-500/20" />
                      ) : (
                        <FileText className="h-4 w-4 text-accent" />
                      )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-surface border border-border shadow-sm">
                      {item.direction === "in" ? (
                        <Download className="h-2.5 w-2.5 text-success" />
                      ) : (
                        <Upload className="h-2.5 w-2.5 text-accent" />
                      )}
                    </div>
                  </div>

                  {/* Transfer Details */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text" title={item.name}>
                      {item.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                      <span>{formatBytes(item.size)}</span>
                      <span>•</span>
                      <span>{item.direction === "in" ? `From: ${item.peerName}` : `To: ${item.peerName}`}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-faint">
                      <span>{formatDate(item.timestamp)}</span>
                      <span>•</span>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {item.status === "completed" && item.savePath && (
                  <div className="flex gap-2 border-t border-border/50 pt-2 opacity-80 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      type="button"
                      onClick={() => void platformAdapter.openPath(item.savePath!)}
                      className="kuno-focus-ring flex flex-1 items-center justify-center gap-1 rounded-pill border border-border bg-surface py-1 text-[11px] font-semibold text-text shadow-sm transition-all duration-150 hover:bg-surface-hover active:scale-95"
                    >
                      <ExternalLink className="h-3 w-3" />
                      ファイルを開く
                    </button>
                    <button
                      type="button"
                      onClick={() => void platformAdapter.revealPath(item.savePath!)}
                      className="kuno-focus-ring flex flex-1 items-center justify-center gap-1 rounded-pill border border-border bg-surface py-1 text-[11px] font-semibold text-text shadow-sm transition-all duration-150 hover:bg-surface-hover active:scale-95"
                    >
                      <Folder className="h-3 w-3" />
                      フォルダを表示
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-success">
        <CheckCircle className="h-3 w-3" />
        完了
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-danger">
        <AlertCircle className="h-3 w-3" />
        失敗
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-faint">
      <XCircle className="h-3 w-3" />
      キャンセル
    </span>
  );
}
