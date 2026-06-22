export type RealtimeConnectionMode = "host" | "join";

export type RealtimeConnectOptions = {
  roomId: string;
  localPeerId: string;
  displayName: string;
  mode: RealtimeConnectionMode;
  signalingUrl?: string;
  nativeEndpoint?: string;
};

export type RealtimeTextPayload = {
  id: string;
  senderId: string;
  senderName: string;
  createdAt: number;
  text: string;
};

export type RealtimeAssetMeta = {
  id: string;
  messageId: string;
  transferId: string;
  senderId: string;
  senderName: string;
  createdAt: number;
  kind: "image" | "file";
  name: string;
  size: number;
  mime: string;
  sha256?: string;
  caption?: string;
  thumbnail?: string;
  isFolder?: boolean;
  nativeKey?: string;
};

export type RealtimeBinarySource = {
  size: number;
  readChunk: (offset: number, length: number) => Promise<ArrayBuffer>;
  close?: () => Promise<void>;
  nativePath?: string;
};

export type RealtimeControlMessage =
  | ({ v: 1; type: "text" } & RealtimeTextPayload)
  | { v: 1; type: "ack"; id: string; receivedAt: number }
  | { v: 1; type: "asset-start"; asset: RealtimeAssetMeta }
  | { v: 1; type: "request-transfer"; messageId: string; transferId: string; byteOffset?: number }
  | { v: 1; type: "request-native-transfer"; messageId: string; transferId: string }
  | { v: 1; type: "asset-progress"; id: string; transferId: string; progress: number; receivedBytes: number }
  | { v: 1; type: "asset-complete"; id: string; transferId: string; objectUrl: string; sha256?: string }
  | { v: 1; type: "asset-failed"; id: string; transferId: string; message: string }
  | { v: 1; type: "asset-cancelled"; id: string; transferId: string; message?: string }
  | { v: 1; type: "asset-pause"; id: string; transferId: string }
  | { v: 1; type: "asset-resume"; id: string; transferId: string }
  | { v: 1; type: "typing"; senderId: string; senderName: string; isTyping: boolean; at: number }
  | { v: 1; type: "ping"; at: number }
  | { v: 1; type: "pong"; at: number };

export type RealtimePeer = {
  peerId: string;
  displayName: string;
};

export type RealtimeCallbacks = {
  onStatus: (status: "connecting" | "connected" | "reconnecting" | "offline" | "failed" | "pairing") => void;
  onPeer: (peer: RealtimePeer) => void;
  onText: (payload: RealtimeTextPayload) => void;
  onAssetStart: (asset: RealtimeAssetMeta) => void;
  onAssetProgress: (input: { id: string; transferId: string; progress: number; receivedBytes?: number }) => void;
  onAssetComplete: (input: { id: string; transferId: string; objectUrl: string; blob?: Blob; meta?: RealtimeAssetMeta }) => void;
  onAssetFailed: (input: { id: string; transferId: string; message: string }) => void;
  onAssetCancelled: (input: { id: string; transferId: string; message?: string }) => void;
  onAssetPaused: (input: { id: string; transferId: string }) => void;
  onAssetResumed: (input: { id: string; transferId: string }) => void;
  onLocalAssetProgress: (input: { id: string; transferId: string; progress: number; receivedBytes?: number }) => void;
  onAck: (messageId: string) => void;
  onTyping: (input: { peerId: string; senderName: string; isTyping: boolean }) => void;
  onError: (message: string) => void;
};
