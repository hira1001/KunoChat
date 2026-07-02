export type MessageKind = "text" | "image" | "file" | "bundle" | "link" | "code" | "system";

export type MessageStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "receiving"
  | "received"
  | "saved"
  | "failed"
  | "cancelled";

export type ConnectionStatus =
  | "pairing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "failed";

export type AppView = "mini" | "main" | "pairing" | "settings" | "history";

export type Sender = "me" | "peer" | "system";

export type TextContent = {
  text: string;
  plainText: string;
  length: number;
};

export type LinkContent = {
  url: string;
  host: string;
  title?: string;
};

export type CodeContent = {
  code: string;
  language?: string;
  filename?: string;
};

export type AssetKind = "image" | "file";

export type AssetContent = {
  id: string;
  kind: AssetKind;
  name: string;
  extension?: string;
  size: number;
  mime: string;
  transferId: string;
  progress?: number;
  localPath?: string;
  savePath?: string;
  thumbnailPath?: string;
  previewUrl?: string;
  file?: File;
  width?: number;
  height?: number;
  sha256?: string;
  thumbnail?: string;
  isFolder?: boolean;
};

export type BundleContent = {
  caption?: string;
  items: AssetContent[];
  totalSize: number;
  count: number;
  transferId: string;
};

export type TransferError = {
  code: string;
  message: string;
};

export type ChatMessage = {
  id: string;
  conversationId?: string;
  kind: MessageKind;
  sender: Sender;
  senderId: string;
  senderName: string;
  createdAt: number;
  status: MessageStatus;
  progress?: number;
  text?: TextContent;
  link?: LinkContent;
  code?: CodeContent;
  asset?: AssetContent;
  bundle?: BundleContent;
  error?: TransferError;
};

export type ConversationSummary = {
  id: string;
  displayName: string;
  peerId?: string;
  peerHint?: string;
  source?: "lan" | "tailscale" | "manual" | "unknown";
  platform?: string;
  fingerprint?: string;
  unreadCount: number;
  lastMessageAt?: number;
  lastMessagePreview?: string;
  connectionStatus?: ConnectionStatus;
};

export type ConversationDraft = {
  draftText: string;
  attachments: DraftAttachment[];
};

export type DraftAttachment = {
  id: string;
  kind: AssetKind;
  name: string;
  size: number;
  mime: string;
  localPath?: string;
  previewUrl?: string;
  file?: File;
  isFolder?: boolean;
};

export type TransferState = {
  transferId: string;
  status: MessageStatus;
  progress: number;
  size?: number;
  mime?: string;
  localPath?: string;
  sha256?: string;
  error?: TransferError;
  speed?: number;
  eta?: number;
  lastProgressUpdate?: number;
  transferredBytes?: number;
};

export type KunoSettings = {
  localPeerId: string;
  displayName: string;
  peerDisplayName?: string;
  pairedRoomId?: string;
  saveFolder: string;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  notifications: boolean;
  sound: boolean;
  shortcut: string;
  theme: "light" | "dark";
  trustedPeer?: {
    publicKey: string;
    fingerprint: string;
    verifiedAt: number;
  };
};
