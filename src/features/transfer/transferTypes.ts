export type TransferPriority = "instant" | "high" | "normal" | "low";

export type TransferQueueItem = {
  id: string;
  itemId: string;
  assetId?: string;
  priority: TransferPriority;
  status: "queued" | "preparing" | "sending" | "paused" | "complete" | "failed";
  progress: number;
  sentBytes: number;
  totalBytes: number;
  createdAt: number;
};

export type TransferEnvelope<TPayload> = {
  v: 1;
  id: string;
  type: string;
  roomId: string;
  senderId: string;
  createdAt: number;
  priority: TransferPriority;
  payload: TPayload;
};

export type TypingEnvelope = TransferEnvelope<{
  peerId: string;
  isTyping: boolean;
}>;

export type ChunkHeader = {
  transferId: string;
  index: number;
  total: number;
  offset: number;
  byteLength: number;
};

export const TRANSFER_LIMITS = {
  chunkSize: 128 * 1024,
  maxBufferedAmount: 8 * 1024 * 1024,
  bufferedAmountLowThreshold: 2 * 1024 * 1024,
  instantControlTimeoutMs: 500
} as const;
