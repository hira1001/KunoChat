import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { realtimeClient } from "../realtime/realtimeClient";
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
  failMessage: (messageId: string, message: string, code?: string) => void;
  markInterruptedTransfers: (message?: string) => void;
  cancelMessage: (messageId: string, notify?: (message: ChatMessage, transferIds: string[]) => void) => void;
  retryMessage: (messageId: string, transport?: (message: ChatMessage) => Promise<void> | void) => Promise<void>;
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
    thumbnail?: string;
  }) => void;
  updateTransferProgress: (input: { messageId: string; transferId: string; progress: number }) => void;
  completeTransfer: (input: { messageId: string; transferId: string; objectUrl?: string; savePath?: string; sha256?: string }) => void;
  failTransfer: (input: { messageId: string; transferId: string; message: string }) => void;
  cancelTransfer: (input: { messageId: string; transferId: string; message?: string }) => void;
  setDraftText: (text: string) => void;
  addAttachments: (attachments: DraftAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setDraggingOver: (value: boolean) => void;
  sendDraft: (transport?: (message: ChatMessage) => Promise<void> | void) => Promise<void>;
  updateSettings: (settings: Partial<KunoSettings>) => void;
  clearHistory: () => void;
  requestDownload: (messageId: string) => void;
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
        set((state) => {
          const target = state.messages.find((message) => message.id === messageId);
          const nextTransferStates = { ...state.transferStates };
          if (target) {
            for (const transferId of transferIdsForMessage(target)) {
              nextTransferStates[transferId] = {
                ...(nextTransferStates[transferId] ?? { transferId, progress: target.progress ?? 0 }),
                status,
                progress: status === "sent" || status === "received" || status === "saved" ? 100 : nextTransferStates[transferId]?.progress ?? target.progress ?? 0
              };
            }
          }

          return {
            messages: state.messages.map((message) =>
              message.id === messageId ? { ...message, status, error: status === "failed" ? message.error : undefined } : message
            ),
            transferStates: nextTransferStates
          };
        }),
      failMessage: (messageId, message, code = "send_failed") =>
        set((state) => failMessageState(state, messageId, message, code)),
      markInterruptedTransfers: (message = "接続が中断されました。Retryで再送できます。") =>
        set((state) => {
          const interruptedIds = state.messages
            .filter((chatMessage) => chatMessage.sender === "me" && (chatMessage.status === "sending" || chatMessage.status === "queued"))
            .map((chatMessage) => chatMessage.id);

          let nextMessages = state.messages;
          let nextTransferStates = state.transferStates;
          for (const messageId of interruptedIds) {
            const failedState = failMessageState(
              { messages: nextMessages, transferStates: nextTransferStates },
              messageId,
              message,
              "connection_interrupted"
            );
            nextMessages = failedState.messages;
            nextTransferStates = failedState.transferStates;
          }

          return {
            messages: nextMessages,
            transferStates: nextTransferStates
          };
        }),
      cancelMessage: (messageId, notify) => {
        const message = get().messages.find((chatMessage) => chatMessage.id === messageId);
        if (!message || message.sender !== "me" || (message.status !== "sending" && message.status !== "queued")) {
          return;
        }

        const transferIds = transferIdsForMessage(message);
        notify?.(message, transferIds);
        set((state) => cancelMessageState(state, messageId, "送信をキャンセルしました。"));
      },
      retryMessage: async (messageId, transport) => {
        const { connectionStatus, messages } = get();
        const message = messages.find((chatMessage) => chatMessage.id === messageId);
        if (!message || message.sender !== "me" || (message.status !== "failed" && message.status !== "cancelled")) {
          return;
        }

        if (connectionStatus !== "connected") {
          get().failMessage(messageId, "相手と再接続してから再送してください。", "not_connected");
          return;
        }

        if (!isRetryableMessage(message)) {
          get().failMessage(messageId, "このファイルは再送に必要なローカル参照がありません。もう一度選択してください。", "payload_unavailable");
          return;
        }

        const retryingMessage = resetMessageForRetry(message);
        set((state) => ({
          messages: state.messages.map((chatMessage) => (chatMessage.id === messageId ? retryingMessage : chatMessage)),
          transferStates: {
            ...state.transferStates,
            ...transferStatesForRetry(retryingMessage)
          }
        }));

        if (!transport) {
          get().failMessage(messageId, "送信経路が準備できていません。", "transport_missing");
          return;
        }

        try {
          await transport(retryingMessage);
          get().markMessageStatus(messageId, "sent");
        } catch (error) {
          if (get().messages.find((chatMessage) => chatMessage.id === messageId)?.status === "cancelled") {
            return;
          }
          get().failMessage(messageId, error instanceof Error ? error.message : "再送に失敗しました。", "retry_failed");
        }
      },
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
          const existingMessage = state.messages.find((message) => message.id === input.id);
          if (
            existingMessage &&
            existingMessage.status !== "failed" &&
            existingMessage.status !== "queued" &&
            existingMessage.status !== "receiving"
          ) {
            return state;
          }

          if (existingMessage) {
            return {
              messages: state.messages.map((message) =>
                message.id === input.id
                  ? {
                      ...message,
                      status: "queued",
                      progress: 0,
                      error: undefined,
                      asset: {
                        id: input.id,
                        kind: input.kind,
                        name: input.name,
                        size: input.size,
                        mime: input.mime,
                        sha256: input.sha256,
                        transferId: input.transferId,
                        progress: 0,
                        thumbnail: input.thumbnail
                      }
                    }
                  : message
              ),
              transferStates: {
                ...state.transferStates,
                [input.transferId]: {
                  transferId: input.transferId,
                  status: "queued",
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
                status: "queued",
                progress: 0,
                asset: {
                  id: input.id,
                  kind: input.kind,
                  name: input.name,
                  size: input.size,
                  mime: input.mime,
                  sha256: input.sha256,
                  transferId: input.transferId,
                  progress: 0,
                  thumbnail: input.thumbnail
                }
              }
            ],
            transferStates: {
              ...state.transferStates,
              [input.transferId]: {
                transferId: input.transferId,
                status: "queued",
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
      completeTransfer: ({ messageId, transferId, objectUrl, savePath, sha256 }) =>
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
                        savePath: savePath || message.asset.savePath,
                        sha256: sha256 || message.asset.sha256
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
              progress: 100,
              sha256: sha256 || state.transferStates[transferId]?.sha256
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
      cancelTransfer: ({ messageId, transferId, message = "転送がキャンセルされました。" }) =>
        set((state) => {
          const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
          return {
            messages: state.messages.map((chatMessage) =>
              chatMessage.id === messageId
                ? {
                    ...chatMessage,
                    status: "cancelled",
                    error: {
                      code: "transfer_cancelled",
                      message
                    },
                    asset: chatMessage.asset ? { ...chatMessage.asset, progress: chatMessage.progress ?? chatMessage.asset.progress } : chatMessage.asset
                  }
                : chatMessage
            ),
            transferStates: {
              ...state.transferStates,
              [transferId]: {
                ...(state.transferStates[transferId] ?? {
                  transferId,
                  progress: target?.progress ?? 0
                }),
                status: "cancelled",
                error: {
                  code: "transfer_cancelled",
                  message
                }
              }
            }
          };
        }),
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

        const bundleTransferId = `tr_${now}`;
        const message: ChatMessage =
          attachments.length > 1 || (attachments.length === 1 && trimmed)
            ? {
                ...baseMessage,
                kind: "bundle",
                bundle: {
                  caption: trimmed || undefined,
                  count: attachments.length,
                  totalSize: attachments.reduce((total, attachment) => total + attachment.size, 0),
                  transferId: bundleTransferId,
                  items: attachments.map((attachment, index) => ({
                    id: attachment.id,
                    kind: attachment.kind,
                    name: attachment.name,
                    size: attachment.size,
                    mime: attachment.mime,
                    localPath: attachment.localPath,
                    previewUrl: attachment.previewUrl,
                    file: attachment.file,
                    transferId: `${bundleTransferId}_${index}`
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
          get().failMessage(message.id, "送信経路が準備できていません。", "transport_missing");
          return;
        }

        try {
          await transport(message);
          get().markMessageStatus(message.id, "sent");
        } catch (error) {
          if (get().messages.find((chatMessage) => chatMessage.id === message.id)?.status === "cancelled") {
            return;
          }
          get().failMessage(message.id, error instanceof Error ? error.message : "送信に失敗しました。", "send_failed");
        }
      },
      updateSettings: (settings) =>
        set((state) => ({
          settings: { ...state.settings, ...settings }
        })),
      clearHistory: () => set({ messages: [] }),
      requestDownload: (messageId) => {
        const message = get().messages.find((m) => m.id === messageId);
        if (!message || message.sender === "me" || message.status !== "queued") {
          return;
        }

        get().markMessageStatus(messageId, "receiving");

        const transferIds = message.asset ? [message.asset.transferId] : (message.bundle?.items.map((i) => i.transferId) ?? []);
        for (const transferId of transferIds) {
          realtimeClient.requestTransfer(messageId, transferId);
        }
      }
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

function failMessageState(
  state: Pick<ChatStore, "messages" | "transferStates">,
  messageId: string,
  message: string,
  code: string
): Pick<ChatStore, "messages" | "transferStates"> {
  const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
  if (!target) {
    return {
      messages: state.messages,
      transferStates: state.transferStates
    };
  }

  const transferIds = transferIdsForMessage(target);
  const nextTransferStates = { ...state.transferStates };
  for (const transferId of transferIds) {
    nextTransferStates[transferId] = {
      ...(nextTransferStates[transferId] ?? { transferId, progress: target.progress ?? 0 }),
      status: "failed",
      error: { code, message }
    };
  }

  return {
    messages: state.messages.map((chatMessage) =>
      chatMessage.id === messageId
        ? {
            ...chatMessage,
            status: "failed",
            error: { code, message }
          }
        : chatMessage
    ),
    transferStates: nextTransferStates
  };
}

function cancelMessageState(
  state: Pick<ChatStore, "messages" | "transferStates">,
  messageId: string,
  message: string
): Pick<ChatStore, "messages" | "transferStates"> {
  const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
  if (!target) {
    return {
      messages: state.messages,
      transferStates: state.transferStates
    };
  }

  const nextTransferStates = { ...state.transferStates };
  for (const transferId of transferIdsForMessage(target)) {
    nextTransferStates[transferId] = {
      ...(nextTransferStates[transferId] ?? { transferId, progress: target.progress ?? 0 }),
      status: "cancelled",
      error: { code: "transfer_cancelled", message }
    };
  }

  return {
    messages: state.messages.map((chatMessage) =>
      chatMessage.id === messageId
        ? {
            ...chatMessage,
            status: "cancelled",
            error: { code: "transfer_cancelled", message }
          }
        : chatMessage
    ),
    transferStates: nextTransferStates
  };
}

function transferIdsForMessage(message: ChatMessage): string[] {
  if (message.asset) {
    return [message.asset.transferId];
  }
  if (message.bundle) {
    return Array.from(new Set(message.bundle.items.map((item) => item.transferId)));
  }
  return [];
}

function isRetryableMessage(message: ChatMessage): boolean {
  if (message.kind === "text") {
    return Boolean(message.text?.text);
  }
  if (message.asset) {
    return Boolean(message.asset.file || message.asset.localPath);
  }
  if (message.bundle) {
    return message.bundle.items.every((item) => item.file || item.localPath);
  }
  return false;
}

function resetMessageForRetry(message: ChatMessage): ChatMessage {
  return {
    ...message,
    status: "sending",
    progress: 0,
    error: undefined,
    asset: message.asset ? { ...message.asset, progress: 0 } : message.asset,
    bundle: message.bundle
      ? {
          ...message.bundle,
          items: message.bundle.items.map((item) => ({ ...item, progress: 0 }))
        }
      : message.bundle
  };
}

function transferStatesForRetry(message: ChatMessage): Record<string, TransferState> {
  const states: Record<string, TransferState> = {};
  if (message.asset) {
    states[message.asset.transferId] = {
      transferId: message.asset.transferId,
      status: "sending",
      progress: 0,
      size: message.asset.size,
      mime: message.asset.mime,
      localPath: message.asset.localPath,
      sha256: message.asset.sha256
    };
  }
  if (message.bundle) {
    for (const item of message.bundle.items) {
      states[item.transferId] = {
        transferId: item.transferId,
        status: "sending",
        progress: 0,
        size: item.size,
        mime: item.mime,
        localPath: item.localPath,
        sha256: item.sha256
      };
    }
  }
  return states;
}

function createLocalPeerId(): string {
  return `peer_${crypto.randomUUID()}`;
}

function isChatMessage(message: unknown): message is ChatMessage {
  return Boolean(message && typeof message === "object" && "id" in message && "kind" in message && "status" in message);
}
