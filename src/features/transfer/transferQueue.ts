import type { TransferQueueItem } from "./transferTypes";

export function sortTransferQueue(items: TransferQueueItem[]): TransferQueueItem[] {
  const priorityRank: Record<TransferQueueItem["priority"], number> = {
    instant: 0,
    high: 1,
    normal: 2,
    low: 3
  };

  return [...items].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.createdAt - b.createdAt);
}

export function createInstantTextQueueItem(itemId: string): TransferQueueItem {
  return {
    id: `queue_${crypto.randomUUID()}`,
    itemId,
    priority: "instant",
    status: "queued",
    progress: 0,
    sentBytes: 0,
    totalBytes: 0,
    createdAt: Date.now()
  };
}
