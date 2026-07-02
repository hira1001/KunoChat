import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { realtimeClient } from "../realtime/realtimeClient";
import type {
  AppView,
  ChatMessage,
  ConversationDraft,
  ConversationSummary,
  ConnectionStatus,
  DeliveryOutboxRecord,
  DeliveryOutboxStatus,
  DraftAttachment,
  KunoSettings,
  TransferError,
  TransferState,
  TrustedPeer
} from "./messageTypes";
import { dbService, type TransferHistoryItem } from "../storage/db";
import { platformAdapter } from "../native/platformAdapter";

type ChatStore = {
  storageVersion: number;
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  activeConversationId: string;
  conversations: ConversationSummary[];
  conversationDrafts: Record<string, ConversationDraft>;
  messages: ChatMessage[];
  deliveryOutbox: DeliveryOutboxRecord[];
  draftText: string;
  attachments: DraftAttachment[];
  transferStates: Record<string, TransferState>;
  unreadCount: number;
  isDraggingOver: boolean;
  peerTyping: boolean;
  peerTypingAt: number;
  settings: KunoSettings;
  setView: (view: AppView) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  selectConversation: (conversationId: string) => void;
  activateConversation: (input: {
    peerId?: string;
    displayName?: string;
    peerHint?: string;
    source?: ConversationSummary["source"];
    platform?: string;
    fingerprint?: string;
  }) => string;
  setConversationTrustedPeer: (conversationId: string, trustedPeer: TrustedPeer) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
  setPeerTyping: (isTyping: boolean, at?: number) => void;
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
    isFolder?: boolean;
  }) => void;
  updateTransferProgress: (input: { messageId: string; transferId: string; progress: number; receivedBytes?: number }) => void;
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
  history: TransferHistoryItem[];
  loadHistory: () => Promise<void>;
  clearHistoryList: () => Promise<void>;
};

export const DEFAULT_CONVERSATION_ID = "conversation_default";

const defaultSettings: KunoSettings = {
  localPeerId: createLocalPeerId(),
  displayName: "Atsushi",
  saveFolder: "~/Downloads/KunoChat",
  alwaysOnTop: false,
  launchAtLogin: false,
  notifications: true,
  sound: true,
  shortcut: "CommandOrControl + Shift + Space",
  theme: "light"
};

const currentStorageVersion = 3;
const pendingConnectionError = {
  code: "pending_connection",
  message: "接続後に自動送信されます。"
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      storageVersion: currentStorageVersion,
      currentView: "main",
      connectionStatus: "pairing",
      activeConversationId: DEFAULT_CONVERSATION_ID,
      conversations: [createDefaultConversation()],
      conversationDrafts: {
        [DEFAULT_CONVERSATION_ID]: { draftText: "", attachments: [] }
      },
      messages: [],
      deliveryOutbox: [],
      draftText: "",
      attachments: [],
      transferStates: {},
      unreadCount: 0,
      isDraggingOver: false,
      peerTyping: false,
      peerTypingAt: 0,
      settings: defaultSettings,
      history: [],
      setView: (currentView) => set({ currentView }),
      setConnectionStatus: (connectionStatus) =>
        set((state) => ({
          connectionStatus,
          conversations: state.conversations.map((conversation) =>
            conversation.id === state.activeConversationId ? { ...conversation, connectionStatus } : conversation
          )
        })),
      selectConversation: (conversationId) =>
        set((state) => {
          const nextDrafts = {
            ...state.conversationDrafts,
            [state.activeConversationId]: {
              draftText: state.draftText,
              attachments: state.attachments
            }
          };
          const nextConversation =
            state.conversations.find((conversation) => conversation.id === conversationId) ??
            ({
              ...createDefaultConversation(),
              id: conversationId
            } satisfies ConversationSummary);
          const nextConversations = upsertConversation(state.conversations, {
            ...nextConversation,
            unreadCount: 0
          });
          const nextDraft = nextDrafts[conversationId] ?? { draftText: "", attachments: [] };
          return {
            activeConversationId: conversationId,
            conversations: nextConversations,
            conversationDrafts: nextDrafts,
            draftText: nextDraft.draftText,
            attachments: nextDraft.attachments,
            unreadCount: totalUnread(nextConversations)
          };
        }),
      activateConversation: (input) => {
        const conversationId = conversationIdForPeer(input.peerId ?? input.peerHint ?? input.fingerprint);
        set((state) => {
          const existing = state.conversations.find((conversation) => conversation.id === conversationId);
          const nextConversations = upsertConversation(state.conversations, {
            id: conversationId,
            displayName: input.displayName || existing?.displayName || input.peerHint || "Peer",
            peerId: input.peerId ?? existing?.peerId,
            peerHint: input.peerHint ?? existing?.peerHint,
            source: input.source ?? existing?.source ?? "unknown",
            platform: input.platform ?? existing?.platform,
            fingerprint: input.fingerprint ?? existing?.fingerprint,
            trustedPeer: existing?.trustedPeer,
            unreadCount: existing?.unreadCount ?? 0,
            lastMessageAt: existing?.lastMessageAt,
            lastMessagePreview: existing?.lastMessagePreview,
            connectionStatus: state.connectionStatus
          });
          return {
            activeConversationId: conversationId,
            conversations: nextConversations,
            conversationDrafts: {
              ...state.conversationDrafts,
              [state.activeConversationId]: {
                draftText: state.draftText,
                attachments: state.attachments
              },
              [conversationId]: state.conversationDrafts[conversationId] ?? { draftText: "", attachments: [] }
            },
            draftText: state.conversationDrafts[conversationId]?.draftText ?? "",
            attachments: state.conversationDrafts[conversationId]?.attachments ?? [],
            unreadCount: totalUnread(nextConversations)
          };
        });
        return conversationId;
      },
      setConversationTrustedPeer: (conversationId, trustedPeer) =>
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === conversationId ? { ...conversation, trustedPeer } : conversation
          )
        })),
      incrementUnread: () => set((state) => ({ unreadCount: Math.min(state.unreadCount + 1, 99) })),
      clearUnread: () =>
        set((state) => {
          const nextConversations = state.conversations.map((conversation) =>
            conversation.id === state.activeConversationId ? { ...conversation, unreadCount: 0 } : conversation
          );
          return { unreadCount: totalUnread(nextConversations), conversations: nextConversations };
        }),
      setPeerTyping: (peerTyping, at = Date.now()) =>
        set((state) => (at < state.peerTypingAt ? state : { peerTyping, peerTypingAt: at })),
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

          const nextDeliveryOutbox = updateOutboxStatusForMessage(state.deliveryOutbox, target, status);
          return {
            messages: state.messages.map((message) =>
              message.id === messageId ? { ...message, status, error: status === "failed" ? message.error : undefined } : message
            ),
            transferStates: nextTransferStates,
            deliveryOutbox: nextDeliveryOutbox
          };
        }),
      failMessage: (messageId, message, code = "send_failed") =>
        set((state) => failMessageState(state, messageId, message, code)),
      markInterruptedTransfers: (message = "接続が中断されました。Retryで再送できます。") =>
        set((state) => {
          const interruptedIds = state.messages
            .filter(
              (chatMessage) =>
                chatMessage.sender === "me" &&
                (chatMessage.status === "sending" ||
                  (chatMessage.status === "queued" && chatMessage.error?.code !== pendingConnectionError.code))
            )
            .map((chatMessage) => chatMessage.id);

          let nextMessages = state.messages;
          let nextTransferStates = state.transferStates;
          let nextDeliveryOutbox = state.deliveryOutbox;
          for (const messageId of interruptedIds) {
            const failedState = failMessageState(
              { messages: nextMessages, transferStates: nextTransferStates, deliveryOutbox: nextDeliveryOutbox },
              messageId,
              message,
              "connection_interrupted"
            );
            nextMessages = failedState.messages;
            nextTransferStates = failedState.transferStates;
            nextDeliveryOutbox = failedState.deliveryOutbox;
          }

          return {
            messages: nextMessages,
            transferStates: nextTransferStates,
            deliveryOutbox: nextDeliveryOutbox
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
        const queuedForConnection = message?.status === "queued" && message.error?.code === pendingConnectionError.code;
        if (!message || message.sender !== "me" || (message.status !== "failed" && message.status !== "cancelled" && !queuedForConnection)) {
          return;
        }

        if (!isRetryableMessage(message)) {
          get().failMessage(messageId, "このファイルは再送に必要なローカル参照がありません。もう一度選択してください。", "payload_unavailable");
          return;
        }

        if (connectionStatus !== "connected") {
          const queuedMessage = resetMessageForRetry(message, "queued", pendingConnectionError);
          set((state) => ({
            messages: state.messages.map((chatMessage) => (chatMessage.id === messageId ? queuedMessage : chatMessage)),
            deliveryOutbox: upsertOutboxForRetry(state.deliveryOutbox, queuedMessage, state.conversations, "local_queued"),
            transferStates: {
              ...state.transferStates,
              ...transferStatesForRetry(queuedMessage, "queued")
            }
          }));
          return;
        }

        const retryingMessage = resetMessageForRetry(message);
        set((state) => ({
          messages: state.messages.map((chatMessage) => (chatMessage.id === messageId ? retryingMessage : chatMessage)),
          deliveryOutbox: upsertOutboxForRetry(state.deliveryOutbox, retryingMessage, state.conversations, "p2p_sending"),
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
          get().markMessageStatus(messageId, retryingMessage.asset || retryingMessage.bundle ? "queued" : "sent");
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
          const conversationId = conversationIdForPeer(input.senderId);
          const active = state.activeConversationId === conversationId;
          const unreadIncrement = active && state.currentView !== "mini" ? 0 : 1;
          const nextConversations = touchConversation(state.conversations, {
            id: conversationId,
            displayName: input.senderName,
            peerId: input.senderId,
            unreadIncrement,
            lastMessageAt: input.createdAt,
            lastMessagePreview: input.text
          });

          return {
            messages: [
              ...state.messages,
              {
                id: input.id,
                conversationId,
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
            conversations: nextConversations,
            unreadCount: totalUnread(nextConversations),
            settings: {
              ...state.settings,
              peerDisplayName: input.senderName
            }
          };
        }),
      receivePeerAsset: (input) =>
        set((state) => {
          void dbService.logTransfer({
            id: input.transferId,
            name: input.name,
            size: input.size,
            direction: "in",
            peerName: input.senderName,
            status: "queued",
            isFolder: input.isFolder
          });
          const conversationId = conversationIdForPeer(input.senderId);
          const active = state.activeConversationId === conversationId;
          const unreadIncrement = active && state.currentView !== "mini" ? 0 : 1;
          const nextConversations = touchConversation(state.conversations, {
            id: conversationId,
            displayName: input.senderName,
            peerId: input.senderId,
            unreadIncrement,
            lastMessageAt: input.createdAt,
            lastMessagePreview: input.name
          });
          const existingMessage = state.messages.find((message) => message.id === input.id);
          if (
            existingMessage &&
            existingMessage.status !== "failed" &&
            existingMessage.status !== "cancelled" &&
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
                      conversationId: message.conversationId ?? conversationId,
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
                        thumbnail: input.thumbnail,
                        isFolder: input.isFolder
                      }
                    }
                  : message
              ),
              conversations: nextConversations,
              unreadCount: totalUnread(nextConversations),
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
                conversationId,
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
                  thumbnail: input.thumbnail,
                  isFolder: input.isFolder
                }
              }
            ],
            conversations: nextConversations,
            unreadCount: totalUnread(nextConversations),
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
      updateTransferProgress: ({ messageId, transferId, progress, receivedBytes }) =>
        set((state) => {
          const now = Date.now();
          const prev = state.transferStates[transferId];
          const message = state.messages.find((candidate) => candidate.id === messageId);
          const activeStatus = message?.sender === "me" ? "sending" : "receiving";

          let speed: number | undefined = prev?.speed;
          let eta: number | undefined = prev?.eta;

          if (prev && receivedBytes !== undefined && prev.transferredBytes !== undefined) {
            const timeDiff = (now - (prev.lastProgressUpdate || now)) / 1000;
            const byteDiff = receivedBytes - prev.transferredBytes;

            if (timeDiff > 0.1 && byteDiff > 0) {
              const currentSpeed = byteDiff / timeDiff;
              speed = prev.speed ? prev.speed * 0.7 + currentSpeed * 0.3 : currentSpeed;

              const remainingBytes = (prev.size || 0) - receivedBytes;
              if (remainingBytes > 0 && speed > 0) {
                eta = Math.round(remainingBytes / speed);
              } else {
                eta = 0;
              }
            }
          }

          return {
            messages: state.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    status:
                      message.status === "queued" || message.status === "sending" || message.status === "receiving"
                        ? activeStatus
                        : message.status,
                    progress,
                    asset: message.asset ? { ...message.asset, progress } : message.asset
                  }
                : message
            ),
            transferStates: {
              ...state.transferStates,
              [transferId]: {
                ...(state.transferStates[transferId] ?? { transferId, status: "receiving", progress: 0 }),
                status:
                  prev?.status === "failed" || prev?.status === "cancelled" || prev?.status === "received"
                    ? prev.status
                    : activeStatus,
                progress,
                speed,
                eta,
                lastProgressUpdate: now,
                transferredBytes: receivedBytes
              }
            }
          };
        }),
      completeTransfer: ({ messageId, transferId, objectUrl, savePath, sha256 }) =>
        set((state) => {
          const target = state.messages.find((message) => message.id === messageId);
          if (target && target.asset && target.asset.transferId === transferId) {
            void dbService.logTransfer({
              id: transferId,
              name: target.asset.name,
              size: target.asset.size,
              direction: target.sender === "me" ? "out" : "in",
              peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
              status: "completed",
              savePath,
              isFolder: target.asset.isFolder
            });
          } else if (target && target.bundle) {
            const item = target.bundle.items.find((i) => i.transferId === transferId);
            if (item) {
              void dbService.logTransfer({
                id: transferId,
                name: item.name,
                size: item.size,
                direction: target.sender === "me" ? "out" : "in",
                peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
                status: "completed",
                savePath,
                isFolder: item.isFolder
              });
            }
          }
          return {
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
                      : message.asset,
                    bundle: message.bundle
                      ? {
                          ...message.bundle,
                          items: message.bundle.items.map((item) =>
                            item.transferId === transferId
                              ? {
                                  ...item,
                                  progress: 100,
                                  previewUrl: objectUrl || item.previewUrl,
                                  savePath: savePath || item.savePath,
                                  sha256: sha256 || item.sha256
                                }
                              : item
                          )
                        }
                      : message.bundle
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
          };
        }),
      failTransfer: ({ messageId, transferId, message }) =>
        set((state) => {
          const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
          if (target && target.asset && target.asset.transferId === transferId) {
            void dbService.logTransfer({
              id: transferId,
              name: target.asset.name,
              size: target.asset.size,
              direction: target.sender === "me" ? "out" : "in",
              peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
              status: "failed",
              isFolder: target.asset.isFolder
            });
          } else if (target && target.bundle) {
            const item = target.bundle.items.find((i) => i.transferId === transferId);
            if (item) {
              void dbService.logTransfer({
                id: transferId,
                name: item.name,
                size: item.size,
                direction: target.sender === "me" ? "out" : "in",
                peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
                status: "failed",
                isFolder: item.isFolder
              });
            }
          }
          return {
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
          };
        }),
      cancelTransfer: ({ messageId, transferId, message = "転送がキャンセルされました。" }) =>
        set((state) => {
          const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
          if (target && target.asset && target.asset.transferId === transferId) {
            void dbService.logTransfer({
              id: transferId,
              name: target.asset.name,
              size: target.asset.size,
              direction: target.sender === "me" ? "out" : "in",
              peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
              status: "cancelled",
              isFolder: target.asset.isFolder
            });
          } else if (target && target.bundle) {
            const item = target.bundle.items.find((i) => i.transferId === transferId);
            if (item) {
              void dbService.logTransfer({
                id: transferId,
                name: item.name,
                size: item.size,
                direction: target.sender === "me" ? "out" : "in",
                peerName: target.sender === "me" ? (state.settings.peerDisplayName || "Peer") : target.senderName,
                status: "cancelled",
                isFolder: item.isFolder
              });
            }
          }
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
      setDraftText: (draftText) =>
        set((state) => ({
          draftText,
          conversationDrafts: {
            ...state.conversationDrafts,
            [state.activeConversationId]: {
              draftText,
              attachments: state.attachments
            }
          }
        })),
      addAttachments: (attachments) =>
        set((state) => {
          const nextAttachments = [...state.attachments, ...attachments];
          return {
            attachments: nextAttachments,
            conversationDrafts: {
              ...state.conversationDrafts,
              [state.activeConversationId]: {
                draftText: state.draftText,
                attachments: nextAttachments
              }
            }
          };
        }),
      removeAttachment: (id) =>
        set((state) => {
          const nextAttachments = state.attachments.filter((attachment) => attachment.id !== id);
          return {
            attachments: nextAttachments,
            conversationDrafts: {
              ...state.conversationDrafts,
              [state.activeConversationId]: {
                draftText: state.draftText,
                attachments: nextAttachments
              }
            }
          };
        }),
      clearAttachments: () =>
        set((state) => ({
          attachments: [],
          conversationDrafts: {
            ...state.conversationDrafts,
            [state.activeConversationId]: {
              draftText: state.draftText,
              attachments: []
            }
          }
        })),
      setDraggingOver: (isDraggingOver) => set({ isDraggingOver }),
      sendDraft: async (transport) => {
        const { activeConversationId, connectionStatus, draftText, attachments, settings } = get();
        const trimmed = draftText.trim();

        if (!trimmed && attachments.length === 0) {
          return;
        }

        const now = Date.now();
        const messageId = createMessageId();
        const pendingConnection = connectionStatus !== "connected";
        const optimisticStatus = pendingConnection ? "queued" : "sending";
        const baseMessage = {
          id: messageId,
          conversationId: activeConversationId,
          sender: "me" as const,
          senderId: settings.localPeerId,
          senderName: settings.displayName || "You",
          createdAt: now,
          status: optimisticStatus as ChatMessage["status"],
          error: pendingConnection ? pendingConnectionError : undefined
        };

        const bundleTransferId = createTransferId();
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
                    transferId: createTransferId()
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
                    transferId: createTransferId()
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

        if (message.asset) {
          void dbService.logTransfer({
            id: message.asset.transferId,
            name: message.asset.name,
            size: message.asset.size,
            direction: "out",
            peerName: settings.peerDisplayName || "Peer",
            status: pendingConnection ? "queued" : "sending",
            isFolder: message.asset.isFolder
          });
        } else if (message.bundle) {
          for (const item of message.bundle.items) {
            void dbService.logTransfer({
              id: item.transferId,
              name: item.name,
              size: item.size,
              direction: "out",
              peerName: settings.peerDisplayName || "Peer",
              status: pendingConnection ? "queued" : "sending",
              isFolder: item.isFolder
            });
          }
        }

        set((state) => {
          const nextConversations = touchConversation(state.conversations, {
            id: activeConversationId,
            displayName: state.conversations.find((conversation) => conversation.id === activeConversationId)?.displayName || settings.peerDisplayName || "Peer",
            lastMessageAt: message.createdAt,
            lastMessagePreview: messagePreview(message),
            unreadIncrement: 0
          });
          return {
            messages: [...state.messages, message],
            conversations: nextConversations,
            deliveryOutbox: upsertOutboxForMessage(state.deliveryOutbox, message, nextConversations, pendingConnection ? "local_queued" : "p2p_sending"),
            draftText: "",
            attachments: [],
            conversationDrafts: {
              ...state.conversationDrafts,
              [activeConversationId]: {
                draftText: "",
                attachments: []
              }
            }
          };
        });

        if (pendingConnection) {
          return;
        }

        if (!transport) {
          get().failMessage(message.id, "送信経路が準備できていません。", "transport_missing");
          return;
        }

        try {
          await transport(message);
          get().markMessageStatus(message.id, message.asset || message.bundle ? "queued" : "sent");
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
      clearHistory: () => set({ messages: [], deliveryOutbox: [] }),
      loadHistory: async () => {
        const history = await dbService.getTransfersHistory();
        set({ history });
      },
      clearHistoryList: async () => {
        await dbService.clearTransfersHistory();
        set({ history: [] });
      },
      requestDownload: async (messageId) => {
        const message = get().messages.find((m) => m.id === messageId);
        if (!message || message.sender === "me" || (message.status !== "queued" && message.status !== "failed")) {
          return;
        }

        get().markMessageStatus(messageId, "receiving");

        const assets = message.asset ? [message.asset] : (message.bundle?.items ?? []);
        for (const asset of assets) {
          const byteOffset = await platformAdapter.inspectPartFileSize(asset.transferId).catch(() => 0) || 0;
          realtimeClient.requestTransfer(messageId, asset.transferId, byteOffset);
        }
      }
    }),
    {
      name: "kunochat-local-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: serializeMessagesForStorage(state.messages),
        deliveryOutbox: state.deliveryOutbox,
        storageVersion: state.storageVersion,
        activeConversationId: state.activeConversationId,
        conversations: state.conversations,
        conversationDrafts: serializeConversationDrafts(state.conversationDrafts),
        connectionStatus: state.connectionStatus,
        unreadCount: state.unreadCount,
        settings: state.settings,
        transferStates: state.transferStates
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<ChatStore> | undefined;
        const settings = {
          ...defaultSettings,
          ...persistedState?.settings,
          localPeerId: persistedState?.settings?.localPeerId ?? defaultSettings.localPeerId
        };
        const migratedMessages = sanitizePersistedMessages(persistedState?.messages, current.messages).map((message) => ({
          ...message,
          conversationId: message.conversationId ?? DEFAULT_CONVERSATION_ID
        }));
        const conversations =
          persistedState?.storageVersion === currentStorageVersion
            ? sanitizePersistedConversations(persistedState?.conversations, settings.peerDisplayName)
            : [createDefaultConversation(settings.peerDisplayName || "Peer", migratedMessages)];
        const activeConversationId =
          conversations.some((conversation) => conversation.id === persistedState?.activeConversationId)
            ? persistedState?.activeConversationId ?? DEFAULT_CONVERSATION_ID
            : conversations[0]?.id ?? DEFAULT_CONVERSATION_ID;
        const conversationDrafts = sanitizePersistedConversationDrafts(persistedState?.conversationDrafts, activeConversationId);
        const activeDraft = conversationDrafts[activeConversationId] ?? { draftText: "", attachments: [] };
        return {
          ...current,
          ...persistedState,
          storageVersion: currentStorageVersion,
          currentView: "main",
          connectionStatus: persistedState?.connectionStatus === "connected" ? "reconnecting" : "pairing",
          activeConversationId,
          conversations,
          conversationDrafts,
          unreadCount: totalUnread(conversations),
          draftText: activeDraft.draftText,
          attachments: activeDraft.attachments,
          transferStates: sanitizePersistedTransferStates(persistedState?.transferStates),
          deliveryOutbox: sanitizePersistedOutbox(persistedState?.deliveryOutbox, migratedMessages, conversations),
          isDraggingOver: false,
          peerTyping: false,
          peerTypingAt: 0,
          settings,
          messages: migratedMessages
        };
      }
    }
  )
);

function sanitizePersistedMessages(messages: unknown, fallback: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return fallback;
  }

  return messages.filter(isChatMessage).map((message) => ({
    ...message,
    status: message.status === "sending" || message.status === "receiving" ? "queued" : message.status,
    asset: message.asset ? withoutFile(message.asset) : undefined,
    bundle: message.bundle
      ? {
          ...message.bundle,
          items: message.bundle.items.map(withoutFile)
        }
      : undefined
  }));
}

function serializeMessagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    asset: message.asset ? withoutFile(message.asset) : undefined,
    bundle: message.bundle
      ? {
          ...message.bundle,
          items: message.bundle.items.map(withoutFile)
        }
      : undefined
  }));
}

function serializeConversationDrafts(drafts: Record<string, ConversationDraft>): Record<string, ConversationDraft> {
  return Object.fromEntries(
    Object.entries(drafts).map(([conversationId, draft]) => [
      conversationId,
      {
        draftText: draft.draftText,
        attachments: draft.attachments.map(withoutFile)
      }
    ])
  );
}

function sanitizePersistedConversations(value: unknown, fallbackName = "Peer"): ConversationSummary[] {
  if (!Array.isArray(value)) {
    return [createDefaultConversation(fallbackName)];
  }
  const conversations = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }
    const conversation = candidate as Partial<ConversationSummary>;
    if (!conversation.id || typeof conversation.id !== "string") {
      return [];
    }
    return [
      {
        id: conversation.id,
        displayName: conversation.displayName || fallbackName || "Peer",
        peerId: conversation.peerId,
        peerHint: conversation.peerHint,
        source: conversation.source,
        platform: conversation.platform,
        fingerprint: conversation.fingerprint,
        unreadCount: Math.max(0, Math.min(99, Math.trunc(conversation.unreadCount ?? 0))),
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
        connectionStatus: conversation.connectionStatus
      } satisfies ConversationSummary
    ];
  });
  return conversations.length > 0 ? conversations : [createDefaultConversation(fallbackName)];
}

function sanitizePersistedConversationDrafts(value: unknown, activeConversationId: string): Record<string, ConversationDraft> {
  if (!value || typeof value !== "object") {
    return { [activeConversationId]: { draftText: "", attachments: [] } };
  }
  const drafts = Object.fromEntries(
    Object.entries(value).flatMap(([conversationId, draft]) => {
      if (!draft || typeof draft !== "object") {
        return [];
      }
      const candidate = draft as Partial<ConversationDraft>;
      return [
        [
          conversationId,
          {
            draftText: typeof candidate.draftText === "string" ? candidate.draftText : "",
            attachments: Array.isArray(candidate.attachments) ? candidate.attachments.map(withoutFile) : []
          } satisfies ConversationDraft
        ]
      ];
    })
  );
  return {
    [activeConversationId]: { draftText: "", attachments: [] },
    ...drafts
  };
}

function withoutFile<T extends { file?: File; previewUrl?: string }>(asset: T): T {
  const { file: _file, ...persistedAsset } = asset;
  if (persistedAsset.previewUrl?.startsWith("blob:")) {
    delete persistedAsset.previewUrl;
  }
  return persistedAsset as T;
}

function sanitizePersistedTransferStates(value: unknown): Record<string, TransferState> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([transferId, state]) => {
      if (!state || typeof state !== "object" || !("transferId" in state) || (state as TransferState).transferId !== transferId) {
        return [];
      }
      const candidate = state as TransferState;
      if (!Number.isFinite(candidate.progress) || candidate.progress < 0 || candidate.progress > 100) {
        return [];
      }
      return [[transferId, { ...candidate, status: candidate.status === "sending" || candidate.status === "receiving" ? "queued" : candidate.status }]];
    })
  );
}

function sanitizePersistedOutbox(value: unknown, messages: ChatMessage[], conversations: ConversationSummary[]): DeliveryOutboxRecord[] {
  const records = Array.isArray(value) ? value.filter(isDeliveryOutboxRecord).map(normalizeOutboxRecord) : [];
  const byMessageId = new Map(records.map((record) => [record.messageId, record]));
  const recovered = messages.flatMap((message) => {
    if (message.sender !== "me" || byMessageId.has(message.id) || message.status === "received" || message.status === "saved") {
      return [];
    }
    const outboxStatus = outboxStatusForMessage(message);
    return outboxStatus ? [createOutboxRecord(message, conversations, outboxStatus)] : [];
  });
  return [...records, ...recovered].sort((left, right) => left.createdAt - right.createdAt);
}

function isDeliveryOutboxRecord(value: unknown): value is DeliveryOutboxRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<DeliveryOutboxRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.messageId === "string" &&
    typeof record.conversationId === "string" &&
    isDeliveryOutboxStatus(record.status) &&
    Number.isFinite(record.sizeBytes) &&
    Number.isFinite(record.attempts) &&
    typeof record.idempotencyKey === "string" &&
    Number.isFinite(record.createdAt) &&
    Number.isFinite(record.updatedAt)
  );
}

function normalizeOutboxRecord(record: DeliveryOutboxRecord): DeliveryOutboxRecord {
  const route = record.status === "local_queued" ? "local_queue" : "p2p";
  return {
    ...record,
    payloadKind: record.payloadKind === "image" || record.payloadKind === "file" ? record.payloadKind : "text",
    route,
    attempts: Math.max(0, Math.floor(record.attempts)),
    sizeBytes: Math.max(0, record.sizeBytes),
    updatedAt: record.updatedAt || record.createdAt
  };
}

function isDeliveryOutboxStatus(value: unknown): value is DeliveryOutboxStatus {
  return (
    value === "local_queued" ||
    value === "p2p_sending" ||
    value === "peer_delivered" ||
    value === "failed_retryable" ||
    value === "failed_final" ||
    value === "cancelled"
  );
}

function upsertOutboxForMessage(
  outbox: DeliveryOutboxRecord[],
  message: ChatMessage,
  conversations: ConversationSummary[],
  status: DeliveryOutboxStatus
): DeliveryOutboxRecord[] {
  if (message.sender !== "me") {
    return outbox;
  }
  const existing = outbox.find((record) => record.messageId === message.id);
  const now = Date.now();
  if (existing) {
    return outbox.map((record) =>
      record.messageId === message.id
        ? {
            ...record,
            status,
            route: routeForOutboxStatus(status),
            attempts: status === "p2p_sending" ? record.attempts + 1 : record.attempts,
            lastAttemptAt: status === "p2p_sending" ? now : record.lastAttemptAt,
            nextRetryAt: undefined,
            errorCode: undefined,
            errorMessage: undefined,
            updatedAt: now
          }
        : record
    );
  }
  return [...outbox, createOutboxRecord(message, conversations, status)];
}

function upsertOutboxForRetry(
  outbox: DeliveryOutboxRecord[],
  message: ChatMessage,
  conversations: ConversationSummary[],
  status: DeliveryOutboxStatus
): DeliveryOutboxRecord[] {
  return upsertOutboxForMessage(outbox, message, conversations, status);
}

function createOutboxRecord(
  message: ChatMessage,
  conversations: ConversationSummary[],
  status: DeliveryOutboxStatus
): DeliveryOutboxRecord {
  const conversationId = message.conversationId ?? DEFAULT_CONVERSATION_ID;
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  const now = Date.now();
  return {
    id: `out_${crypto.randomUUID()}`,
    messageId: message.id,
    conversationId,
    recipientPeerId: conversation?.peerId,
    recipientPeerHint: conversation?.peerHint,
    payloadKind: payloadKindForMessage(message),
    sizeBytes: payloadSizeForMessage(message),
    route: routeForOutboxStatus(status),
    status,
    attempts: status === "p2p_sending" ? 1 : 0,
    lastAttemptAt: status === "p2p_sending" ? now : undefined,
    idempotencyKey: `idem_${crypto.randomUUID()}`,
    createdAt: message.createdAt,
    updatedAt: now
  };
}

function updateOutboxStatusForMessage(
  outbox: DeliveryOutboxRecord[],
  message: ChatMessage | undefined,
  status: ChatMessage["status"]
): DeliveryOutboxRecord[] {
  if (!message || message.sender !== "me") {
    return outbox;
  }
  const nextStatus = outboxStatusForMessage({ ...message, status });
  if (!nextStatus) {
    return outbox;
  }
  const now = Date.now();
  return outbox.map((record) =>
    record.messageId === message.id
      ? {
          ...record,
          status: nextStatus,
          route: routeForOutboxStatus(nextStatus),
          updatedAt: now,
          attempts: nextStatus === "p2p_sending" && record.status !== "p2p_sending" ? record.attempts + 1 : record.attempts,
          lastAttemptAt: nextStatus === "p2p_sending" ? (record.lastAttemptAt ?? now) : record.lastAttemptAt,
          errorCode: nextStatus === "failed_retryable" ? message.error?.code : undefined,
          errorMessage: nextStatus === "failed_retryable" ? message.error?.message : undefined
        }
      : record
  );
}

function failOutboxRecords(outbox: DeliveryOutboxRecord[], messageId: string, code: string, message: string): DeliveryOutboxRecord[] {
  const now = Date.now();
  return outbox.map((record) =>
    record.messageId === messageId
      ? {
          ...record,
          status: "failed_retryable",
          errorCode: code,
          errorMessage: message,
          nextRetryAt: now + 3000,
          updatedAt: now
        }
      : record
  );
}

function outboxStatusForMessage(message: ChatMessage): DeliveryOutboxStatus | undefined {
  if (message.status === "received" || message.status === "saved") {
    return "peer_delivered";
  }
  if (message.status === "cancelled") {
    return "cancelled";
  }
  if (message.status === "failed") {
    return "failed_retryable";
  }
  if (message.status === "queued" && message.error?.code === pendingConnectionError.code) {
    return "local_queued";
  }
  if (message.status === "sending" || message.status === "sent" || message.status === "queued") {
    return "p2p_sending";
  }
  return undefined;
}

function routeForOutboxStatus(status: DeliveryOutboxStatus): DeliveryOutboxRecord["route"] {
  return status === "local_queued" ? "local_queue" : "p2p";
}

function payloadKindForMessage(message: ChatMessage): DeliveryOutboxRecord["payloadKind"] {
  if (message.kind === "image" || message.asset?.kind === "image") {
    return "image";
  }
  if (message.kind === "file" || message.bundle) {
    return "file";
  }
  return "text";
}

function payloadSizeForMessage(message: ChatMessage): number {
  if (message.asset) {
    return message.asset.size;
  }
  if (message.bundle) {
    return message.bundle.totalSize;
  }
  return message.text?.length ?? 0;
}

function failMessageState(
  state: Pick<ChatStore, "messages" | "transferStates" | "deliveryOutbox">,
  messageId: string,
  message: string,
  code: string
): Pick<ChatStore, "messages" | "transferStates" | "deliveryOutbox"> {
  const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
  if (!target) {
    return {
      messages: state.messages,
      transferStates: state.transferStates,
      deliveryOutbox: state.deliveryOutbox
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
    transferStates: nextTransferStates,
    deliveryOutbox: failOutboxRecords(state.deliveryOutbox, messageId, code, message)
  };
}

function cancelMessageState(
  state: Pick<ChatStore, "messages" | "transferStates" | "deliveryOutbox">,
  messageId: string,
  message: string
): Pick<ChatStore, "messages" | "transferStates" | "deliveryOutbox"> {
  const target = state.messages.find((chatMessage) => chatMessage.id === messageId);
  if (!target) {
    return {
      messages: state.messages,
      transferStates: state.transferStates,
      deliveryOutbox: state.deliveryOutbox
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
    transferStates: nextTransferStates,
    deliveryOutbox: updateOutboxStatusForMessage(state.deliveryOutbox, target, "cancelled")
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

function resetMessageForRetry(message: ChatMessage, status: ChatMessage["status"] = "sending", error?: TransferError): ChatMessage {
  return {
    ...message,
    status,
    progress: 0,
    error,
    asset: message.asset ? { ...message.asset, progress: 0 } : message.asset,
    bundle: message.bundle
      ? {
          ...message.bundle,
          items: message.bundle.items.map((item) => ({ ...item, progress: 0 }))
        }
      : message.bundle
  };
}

function transferStatesForRetry(message: ChatMessage, status: TransferState["status"] = "sending"): Record<string, TransferState> {
  const states: Record<string, TransferState> = {};
  if (message.asset) {
    states[message.asset.transferId] = {
      transferId: message.asset.transferId,
      status,
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
        status,
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

function createDefaultConversation(displayName = "Peer", messages: ChatMessage[] = []): ConversationSummary {
  const lastMessage = messages[messages.length - 1];
  return {
    id: DEFAULT_CONVERSATION_ID,
    displayName,
    source: "unknown",
    unreadCount: 0,
    lastMessageAt: lastMessage?.createdAt,
    lastMessagePreview: lastMessage ? messagePreview(lastMessage) : undefined,
    connectionStatus: "pairing"
  };
}

function conversationIdForPeer(value: string | undefined): string {
  if (!value) {
    return DEFAULT_CONVERSATION_ID;
  }
  return `peer_${value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96)}`;
}

function upsertConversation(conversations: ConversationSummary[], next: ConversationSummary): ConversationSummary[] {
  const found = conversations.some((conversation) => conversation.id === next.id);
  if (!found) {
    return [...conversations, next].sort(sortConversations);
  }
  return conversations.map((conversation) => (conversation.id === next.id ? { ...conversation, ...next } : conversation)).sort(sortConversations);
}

function touchConversation(
  conversations: ConversationSummary[],
  input: {
    id: string;
    displayName: string;
    peerId?: string;
    peerHint?: string;
    source?: ConversationSummary["source"];
    platform?: string;
    fingerprint?: string;
    unreadIncrement: number;
    lastMessageAt?: number;
    lastMessagePreview?: string;
  }
): ConversationSummary[] {
  const existing = conversations.find((conversation) => conversation.id === input.id);
  return upsertConversation(conversations, {
    id: input.id,
    displayName: input.displayName || existing?.displayName || "Peer",
    peerId: input.peerId ?? existing?.peerId,
    peerHint: input.peerHint ?? existing?.peerHint,
    source: input.source ?? existing?.source ?? "unknown",
    platform: input.platform ?? existing?.platform,
    fingerprint: input.fingerprint ?? existing?.fingerprint,
    unreadCount: Math.min(99, Math.max(0, (existing?.unreadCount ?? 0) + input.unreadIncrement)),
    lastMessageAt: input.lastMessageAt ?? existing?.lastMessageAt,
    lastMessagePreview: input.lastMessagePreview ?? existing?.lastMessagePreview,
    connectionStatus: existing?.connectionStatus
  });
}

function totalUnread(conversations: ConversationSummary[]): number {
  return Math.min(99, conversations.reduce((total, conversation) => total + conversation.unreadCount, 0));
}

function sortConversations(left: ConversationSummary, right: ConversationSummary): number {
  return (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.displayName.localeCompare(right.displayName);
}

function messagePreview(message: ChatMessage): string {
  if (message.text?.text) {
    return message.text.text;
  }
  if (message.asset) {
    return message.asset.name;
  }
  if (message.bundle) {
    return message.bundle.caption || `${message.bundle.count} files`;
  }
  return "KunoChat";
}

function createMessageId(): string {
  return `msg_${crypto.randomUUID()}`;
}

function createTransferId(): string {
  return `tr_${crypto.randomUUID()}`;
}

function createLocalPeerId(): string {
  return `peer_${crypto.randomUUID()}`;
}

function isChatMessage(message: unknown): message is ChatMessage {
  return Boolean(message && typeof message === "object" && "id" in message && "kind" in message && "status" in message);
}
