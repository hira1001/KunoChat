import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AppView,
  ChatMessage,
  ConnectionStatus,
  DraftAttachment,
  KunoSettings,
  TransferState
} from "./messageTypes";

type ChatStore = {
  storageVersion: number;
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  messages: ChatMessage[];
  draftText: string;
  attachments: DraftAttachment[];
  transferStates: Record<string, TransferState>;
  isDraggingOver: boolean;
  peerTyping: boolean;
  settings: KunoSettings;
  setView: (view: AppView) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setPeerTyping: (isTyping: boolean) => void;
  markMessageStatus: (messageId: string, status: ChatMessage["status"]) => void;
  receivePeerText: (input: { id: string; senderId: string; senderName: string; createdAt: number; text: string }) => void;
  receivePeerAsset: (input: {
    id: string;
    transferId: string;
    senderId: string;
    senderName: string;
    createdAt: number;
    kind: "image" | "file";
    name: string;
    size: number;
    mime: string;
    sha256?: string;
  }) => void;
  updateTransferProgress: (input: { messageId: string; transferId: string; progress: number }) => void;
  completeTransfer: (input: { messageId: string; transferId: string; objectUrl?: string; savePath?: string }) => void;
  failTransfer: (input: { messageId: string; transferId: string; message: string }) => void;
  setDraftText: (text: string) => void;
  addAttachments: (attachments: DraftAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setDraggingOver: (value: boolean) => void;
  sendDraft: (transport?: (message: ChatMessage) => Promise<void> | void) => Promise<void>;
  updateSettings: (settings: Partial<KunoSettings>) => void;
  clearHistory: () => void;
};

const defaultSettings: KunoSettings = {
  localPeerId: createLocalPeerId(),
  displayName: "Atsushi",
  saveFolder: "~/Downloads/KunoChat",
  alwaysOnTop: false,
  launchAtLogin: false,
  notifications: true,
  sound: true,
  shortcut: "CommandOrControl + Shift + Space"
};

const currentStorageVersion = 2;

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      storageVersion: currentStorageVersion,
      currentView: "main",
      connectionStatus: "pairing",
      messages: [],
      draftText: "",
      attachments: [],
      transferStates: {},
      isDraggingOver: false,
      peerTyping: false,
      settings: defaultSettings,
      setView: (currentView) => set({ currentView }),
      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
      setPeerTyping: (peerTyping) => set({ peerTyping }),
      markMessageStatus: (messageId, status) =>
        set((state) => ({
          messages: state.messages.map((message) => (message.id === messageId ? { ...message, status } : message))
        })),
      receivePeerText: (input) =>
        set((state) => {
          if (state.messages.some((message) => message.id === input.id)) {
            return state;
          }

          return {
            messages: [
              ...state.messages,
              {
                id: input.id,
                kind: "text",
                sender: "peer",
                senderId: input.senderId,
                senderName: input.senderName,
                createdAt: input.createdAt,
                status: "received",
                text: {
                  text: input.text,
                  plainText: input.text,
                  length: input.text.length
                }
              }
            ],
            settings: {
              ...state.settings,
              peerDisplayName: input.senderName
            }
          };
        }),
      receivePeerAsset: (input) =>
        set((state) => {
          if (state.messages.some((message) => message.id === input.id)) {
            return state;
          }

          return {
            messages: [
              ...state.messages,
              {
                id: input.id,
                kind: input.kind,
                sender: "peer",
                senderId: input.senderId,
                senderName: input.senderName,
                createdAt: input.createdAt,
                status: "receiving",
                progress: 0,
                asset: {
                  id: input.id,
                  kind: input.kind,
                  name: input.name,
                  size: input.size,
                  mime: input.mime,
                  sha256: input.sha256,
                  transferId: input.transferId,
                  progress: 0
                }
              }
            ],
            transferStates: {
              ...state.transferStates,
              [input.transferId]: {
                transferId: input.transferId,
                status: "receiving",
                progress: 0,
                size: input.size,
                mime: input.mime,
                sha256: input.sha256
              }
            },
            settings: {
              ...state.settings,
              peerDisplayName: input.senderName
            }
          };
        }),
      updateTransferProgress: ({ messageId, transferId, progress }) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  progress,
                  asset: message.asset ? { ...message.asset, progress } : message.asset
                }
              : message
          ),
          transferStates: {
            ...state.transferStates,
            [transferId]: {
              ...(state.transferStates[transferId] ?? { transferId, status: "receiving", progress: 0 }),
              progress
            }
          }
        })),
      completeTransfer: ({ messageId, transferId, objectUrl, savePath }) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  status: message.sender === "me" ? "sent" : "received",
                  progress: 100,
                      asset: message.asset
                    ? {
                        ...message.asset,
                        progress: 100,
                        previewUrl: objectUrl || message.asset.previewUrl,
                        savePath: savePath || message.asset.savePath
                      }
                    : message.asset
                }
              : message
          ),
          transferStates: {
            ...state.transferStates,
            [transferId]: {
              ...(state.transferStates[transferId] ?? { transferId, progress: 100 }),
              status: "received",
              progress: 100
            }
          }
        })),
      failTransfer: ({ messageId, transferId, message }) =>
        set((state) => ({
          messages: state.messages.map((chatMessage) =>
            chatMessage.id === messageId
              ? {
                  ...chatMessage,
                  status: "failed",
                  error: {
                    code: "transfer_failed",
                    message
                  }
                }
              : chatMessage
          ),
          transferStates: {
            ...state.transferStates,
            [transferId]: {
              ...(state.transferStates[transferId] ?? { transferId, progress: 0 }),
              status: "failed",
              error: {
                code: "transfer_failed",
                message
              }
            }
          }
        })),
      setDraftText: (draftText) => set({ draftText }),
      addAttachments: (attachments) =>
        set((state) => ({
          attachments: [...state.attachments, ...attachments]
        })),
      removeAttachment: (id) =>
        set((state) => ({
          attachments: state.attachments.filter((attachment) => attachment.id !== id)
        })),
      clearAttachments: () => set({ attachments: [] }),
      setDraggingOver: (isDraggingOver) => set({ isDraggingOver }),
      sendDraft: async (transport) => {
        const { connectionStatus, draftText, attachments, settings } = get();
        const trimmed = draftText.trim();

        if (!trimmed && attachments.length === 0) {
          return;
        }

        const now = Date.now();
        if (connectionStatus !== "connected") {
          const warningMessage: ChatMessage = {
            id: `sys_${now}`,
            kind: "system",
            sender: "system",
            senderId: "system",
            senderName: "KunoChat",
            createdAt: now,
            status: "failed",
            text: {
              text: "相手と接続してから送信してください。本文やファイルは未接続のまま外部へ送られません。",
              plainText: "相手と接続してから送信してください。本文やファイルは未接続のまま外部へ送られません。",
              length: 38
            },
            error: {
              code: "not_connected",
              message: "Peer connection is not established."
            }
          };

          set((state) => ({
            messages: [...state.messages, warningMessage]
          }));
          return;
        }

        const optimisticStatus = "sending";
        const baseMessage = {
          id: `msg_${now}`,
          sender: "me" as const,
          senderId: "me",
          senderName: settings.displayName || "You",
          createdAt: now,
          status: optimisticStatus as ChatMessage["status"]
        };

        const message: ChatMessage =
          attachments.length > 1 || (attachments.length === 1 && trimmed)
            ? {
                ...baseMessage,
                kind: "bundle",
                bundle: {
                  caption: trimmed || undefined,
                  count: attachments.length,
                  totalSize: attachments.reduce((total, attachment) => total + attachment.size, 0),
                  transferId: `tr_${now}`,
                  items: attachments.map((attachment) => ({
                    id: attachment.id,
                    kind: attachment.kind,
                    name: attachment.name,
                    size: attachment.size,
                    mime: attachment.mime,
                    localPath: attachment.localPath,
                    previewUrl: attachment.previewUrl,
                    file: attachment.file,
                    transferId: `tr_${now}`
                  }))
                }
              }
            : attachments.length === 1
              ? {
                  ...baseMessage,
                  kind: attachments[0].kind,
                  asset: {
                    id: attachments[0].id,
                    kind: attachments[0].kind,
                    name: attachments[0].name,
                    size: attachments[0].size,
                    mime: attachments[0].mime,
                    localPath: attachments[0].localPath,
                    previewUrl: attachments[0].previewUrl,
                    file: attachments[0].file,
                    transferId: `tr_${now}`
                  }
                }
              : {
                  ...baseMessage,
                  kind: "text",
                  text: {
                    text: trimmed,
                    plainText: trimmed,
                    length: trimmed.length
                  }
                };

        set((state) => ({
          messages: [...state.messages, message],
          draftText: "",
          attachments: []
        }));

        if (!transport) {
          get().markMessageStatus(message.id, "failed");
          return;
        }

        try {
          await transport(message);
          get().markMessageStatus(message.id, "sent");
        } catch {
          get().markMessageStatus(message.id, "failed");
        }
      },
      updateSettings: (settings) =>
        set((state) => ({
          settings: { ...state.settings, ...settings }
        })),
      clearHistory: () => set({ messages: [] })
    }),
    {
      name: "kunochat-local-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: state.messages,
        storageVersion: state.storageVersion,
        connectionStatus: state.connectionStatus,
        settings: state.settings
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<ChatStore> | undefined;
        return {
          ...current,
          ...persistedState,
          storageVersion: currentStorageVersion,
          currentView: "main",
          connectionStatus: persistedState?.connectionStatus === "connected" ? "reconnecting" : "pairing",
          attachments: [],
          transferStates: {},
          isDraggingOver: false,
          peerTyping: false,
          settings: {
            ...defaultSettings,
            ...persistedState?.settings,
            localPeerId: persistedState?.settings?.localPeerId ?? defaultSettings.localPeerId
          },
          messages:
            persistedState?.storageVersion === currentStorageVersion
              ? sanitizePersistedMessages(persistedState?.messages, current.messages)
              : []
        };
      }
    }
  )
);

function sanitizePersistedMessages(messages: unknown, fallback: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return fallback;
  }

  return messages.filter(isChatMessage);
}

function createLocalPeerId(): string {
  return `peer_${crypto.randomUUID()}`;
}

function isChatMessage(message: unknown): message is ChatMessage {
  return Boolean(message && typeof message === "object" && "id" in message && "kind" in message && "status" in message);
}
