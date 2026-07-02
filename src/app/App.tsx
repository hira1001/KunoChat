import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { Composer } from "../components/Composer";
import { DropOverlay } from "../components/DropOverlay";
import { Header } from "../components/Header";
import { MessageList } from "../components/MessageList";
import { PairingScreen } from "../components/PairingScreen";
import { SettingsScreen } from "../components/SettingsScreen";
import { WindowShell } from "../components/WindowShell";
import { HistoryTab } from "../components/HistoryTab";
import { DEFAULT_CONVERSATION_ID, useChatStore } from "../features/chat/chatStore";
import { runtimeConfig } from "../features/config/runtimeConfig";
import type { ChatMessage, ConnectionStatus, ConversationSummary, DraftAttachment, TrustedPeer } from "../features/chat/messageTypes";
import { platformAdapter, type DurableTransferSession } from "../features/native/platformAdapter";
import { realtimeClient } from "../features/realtime/realtimeClient";
import type { RealtimeAssetMeta, RealtimeBinarySource } from "../features/realtime/realtimeTypes";
import { parseClipboardItems } from "../features/sendables/clipboardParser";
import { parseDroppedFiles } from "../features/sendables/dropParser";
import { sha256ArrayBuffer, sha256ForAsset } from "../features/transfer/hash";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type AutoConnectPayload = {
  signalingUrl: string;
  roomId: string;
  mode: "host" | "join";
  peerHint: string;
  source?: "lan" | "tailscale";
  deviceName?: string;
  platform?: string;
};

export type DetectedPeer = AutoConnectPayload & {
  id: string;
  lastSeen: number;
};

function detectedPeerId(peer: AutoConnectPayload): string {
  return `${peer.source ?? "lan"}:${peer.peerHint}`;
}

function upsertDetectedPeer(peers: DetectedPeer[], payload: AutoConnectPayload): DetectedPeer[] {
  const nextPeer: DetectedPeer = {
    ...payload,
    id: detectedPeerId(payload),
    lastSeen: Date.now()
  };
  const nextPeers = peers.filter((peer) => peer.id !== nextPeer.id);
  return [nextPeer, ...nextPeers]
    .sort((left, right) => right.lastSeen - left.lastSeen)
    .slice(0, 8);
}

function nativeEndpointForPeer(peerHint: string): string | undefined {
  const host = peerHint.trim();
  if (!host) {
    return undefined;
  }
  return host.includes(":") && !host.startsWith("[") ? `[${host}]:8790` : `${host}:8790`;
}

function signalingUrlForPeer(peerHint: string): string | undefined {
  const host = peerHint.trim();
  if (!host) {
    return undefined;
  }
  return host.includes(":") && !host.startsWith("[") ? `ws://[${host}]:8787` : `ws://${host}:8787`;
}

type NativeTransferEvent = {
  messageId: string;
  transferId: string;
  direction: "incoming" | "outgoing";
  phase: "progress" | "complete" | "failed";
  transferredBytes: number;
  totalBytes: number;
  message?: string;
};

type ConnectionRequestPayload = {
  requestId: string;
  roomId: string;
  requesterName: string;
  requesterPeerId: string;
  peerHint: string;
};

type ConnectionDiagnostic = {
  tone: "info" | "warning" | "danger";
  title: string;
  detail: string;
};

export function App() {
  const {
    currentView,
    connectionStatus,
    activeConversationId,
    conversations,
    messages,
    draftText,
    attachments,
    unreadCount,
    isDraggingOver,
    peerTyping,
    settings,
    setView,
    setConnectionStatus,
    selectConversation,
    activateConversation,
    setConversationTrustedPeer,
    clearUnread,
    setPeerTyping,
    markMessageStatus,
    markInterruptedTransfers,
    receivePeerText,
    receivePeerAsset,
    updateTransferProgress,
    completeTransfer,
    failTransfer,
    cancelTransfer,
    setDraftText,
    addAttachments,
    removeAttachment,
    setDraggingOver,
    sendDraft,
    cancelMessage,
    retryMessage,
    updateSettings,
    clearHistory,
    requestDownload
  } = useChatStore();
  const pairingCode = useMemo(createPairingCode, []);
  const sessionPeerIdRef = useRef<string>();
  const hostedRoomRef = useRef<string>();
  const recoveredTransfersRef = useRef(false);
  const recoveryLoadedRef = useRef(false);
  const recoverySessionsRef = useRef<DurableTransferSession[]>([]);
  const incomingRequestsRef = useRef(new Set<string>());
  const pendingDeliveryIdsRef = useRef(new Set<string>());
  const typingStopTimerRef = useRef<number>();
  const settingsRef = useRef(settings);
  const windowFocusedRef = useRef(typeof document === "undefined" ? true : document.hasFocus());
  const unreadEpochRef = useRef(0);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic>();
  const [lastAutoConnect, setLastAutoConnect] = useState<AutoConnectPayload>();
  const [detectedPeers, setDetectedPeers] = useState<DetectedPeer[]>([]);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequestPayload>();
  if (!sessionPeerIdRef.current) {
    sessionPeerIdRef.current = `${settings.localPeerId}_${crypto.randomUUID()}`;
  }

  useEffect(() => {
    void platformAdapter.positionTopRight();
  }, []);

  useEffect(() => {
    platformAdapter.setSaveFolder(settings.saveFolder);
  }, [settings.saveFolder]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    void platformAdapter.setAlwaysOnTop(settings.alwaysOnTop).catch(() => undefined);
  }, [settings.alwaysOnTop]);

  useEffect(() => {
    void platformAdapter.setUnreadCount(unreadCount).catch(() => undefined);
  }, [unreadCount]);

  useEffect(() => {
    void platformAdapter.setWindowMode(currentView === "mini" ? "mini" : "main").catch(() => undefined);
  }, [currentView]);

  useEffect(() => {
    const dark = settings.theme === "dark";
    document.body.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
  }, [settings.theme]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      const handleFocus = () => {
        windowFocusedRef.current = true;
        markUnreadAsRead();
      };
      const handleBlur = () => {
        windowFocusedRef.current = false;
      };
      window.addEventListener("focus", handleFocus);
      window.addEventListener("blur", handleBlur);
      return () => {
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("blur", handleBlur);
      };
    }

    let disposed = false;
    let unlistenFocus: (() => void) | undefined;
    void getCurrentWindow()
      .isFocused()
      .then((focused) => {
        if (!disposed) {
          windowFocusedRef.current = focused;
        }
      })
      .catch(() => undefined);
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        windowFocusedRef.current = focused;
        if (focused) {
          markUnreadAsRead();
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenFocus = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenFocus?.();
    };
  }, []);

  useEffect(() => {
    if (currentView !== "mini" && windowFocusedRef.current) {
      markUnreadAsRead();
    }
  }, [currentView]);

  useEffect(() => {
    realtimeClient.configure({
      onStatus: (status) => {
        setConnectionStatus(status);
        if (status !== "connected") {
          window.clearTimeout(typingStopTimerRef.current);
          setPeerTyping(false);
        }
        if (status === "connected") {
          setDiagnostic(undefined);
          setView("main");
          void resumeRecoveredTransfers();
          void flushPendingConnectionMessages();
        } else if (status === "reconnecting") {
          markInterruptedTransfers();
          setDiagnostic({
            tone: "warning",
            title: "再接続中",
            detail: "相手PCまたはネットワークが一時的に途切れています。"
          });
        } else if (status === "offline") {
          markInterruptedTransfers("相手がオフラインです。再接続後にRetryで再送できます。");
          setDiagnostic({
            tone: "warning",
            title: "相手がオフラインです",
            detail: "相手のKunoChatが開いているか確認してください。"
          });
        }
      },
      onPeer: (peer) => updateSettings({ peerDisplayName: peer.displayName }),
      onIdentity: (identity) => {
        if (identity.status === "mismatch") {
          setDiagnostic({
            tone: "danger",
            title: "相手PCの確認に失敗しました",
            detail: "以前ペアリングしたデバイスと一致しません。相手PCを確認してから再ペアリングしてください。"
          });
          return;
        }
        const trustedPeer: TrustedPeer = {
          publicKey: identity.publicKey,
          fingerprint: identity.fingerprint,
          verifiedAt: Date.now()
        };
        setConversationTrustedPeer(useChatStore.getState().activeConversationId, trustedPeer);
      },
      onText: (input) => {
        if (useChatStore.getState().messages.some((message) => message.id === input.id)) {
          return;
        }
        receivePeerText(input);
        void notifyIncoming(`${input.senderName}`, input.text);
      },
      onAssetStart: (asset) => {
        const isNewMessage = !useChatStore.getState().messages.some((message) => message.id === asset.messageId);
        receivePeerAsset({
          id: asset.messageId,
          transferId: asset.transferId,
          senderId: asset.senderId,
          senderName: asset.senderName,
          createdAt: asset.createdAt,
          kind: asset.kind,
          name: asset.name,
          size: asset.size,
          mime: asset.mime,
          sha256: asset.sha256,
          thumbnail: asset.thumbnail,
          isFolder: asset.isFolder
        });
        if (isNewMessage) {
          void notifyIncoming(`${asset.senderName} sent a file`, asset.name);
        }
        if (!incomingRequestsRef.current.has(asset.transferId)) {
          incomingRequestsRef.current.add(asset.transferId);
          window.setTimeout(() => {
            const state = useChatStore.getState();
            state.requestDownload(asset.messageId);
          }, 0);
        }
      },
      onAssetProgress: ({ id, transferId, progress, receivedBytes }) =>
        updateTransferProgress({ messageId: id, transferId, progress, receivedBytes }),
      onAssetComplete: ({ id, transferId, objectUrl, blob, meta, savePath }: any) => {
        if (savePath) {
          completeTransfer({
            messageId: id,
            transferId,
            objectUrl,
            savePath,
            sha256: meta?.sha256
          });
          if (settingsRef.current.notifications) {
            void platformAdapter.showNotification({
              title: "KunoChat",
              body: `${meta?.name.replace(/\.zip$/i, "")} を保存しました`
            }).catch(() => undefined);
          }
        } else if (blob && meta) {
          void persistReceivedAsset({ id, transferId, objectUrl, blob, meta }, completeTransfer, failTransfer);
        } else {
          completeTransfer({ messageId: id, transferId, objectUrl });
        }
      },
      onAssetFailed: ({ id, transferId, message }) =>
        failTransfer({ messageId: id, transferId, message }),
      onAssetCancelled: ({ id, transferId, message }) =>
        cancelTransfer({ messageId: id, transferId, message }),
      onAssetPaused: ({ id, transferId }) =>
        markMessageStatus(id, "queued"),
      onAssetResumed: ({ id, transferId }) =>
        markMessageStatus(id, "sending"),
      onLocalAssetProgress: ({ id, transferId, progress, receivedBytes }) =>
        updateTransferProgress({ messageId: id, transferId, progress, receivedBytes }),
      onAck: (messageId) => markMessageStatus(messageId, "received"),
      onTyping: ({ senderName, isTyping, at }) => {
        updateSettings({ peerDisplayName: senderName });
        setPeerTyping(isTyping, at);
        window.clearTimeout(typingStopTimerRef.current);
        if (isTyping) {
          typingStopTimerRef.current = window.setTimeout(() => setPeerTyping(false), 1800);
        }
      },
      onError: (message) => {
        setConnectionStatus("failed");
        markInterruptedTransfers(connectionHelpText(message));
        setDiagnostic({
          tone: "danger",
          title: "接続できません",
          detail: connectionHelpText(message)
        });
      }
    });

    return () => {
      realtimeClient.disconnect();
      window.clearTimeout(typingStopTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void platformAdapter
      .listRecoverableTransferSessions()
      .then((sessions) => {
        if (disposed) {
          return;
        }
        recoverySessionsRef.current = sessions;
        recoveryLoadedRef.current = true;
        const state = useChatStore.getState();
        for (const session of sessions) {
          const progress = session.expectedSize === 0 ? 100 : Math.min(100, Math.round((session.transferredBytes / session.expectedSize) * 100));
          state.updateTransferProgress({
            messageId: session.messageId,
            transferId: session.transferId,
            progress,
            receivedBytes: session.transferredBytes
          });
        }
        void resumeRecoveredTransfers();
      })
      .catch(() => {
        recoveryLoadedRef.current = true;
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (currentView !== "pairing" || connectionStatus === "connected" || hostedRoomRef.current === pairingCode) {
      return;
    }

    hostedRoomRef.current = pairingCode;
    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }

    void realtimeClient.connect({
      roomId: pairingCode,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "host",
      trustedPeer: trustedPeerForActiveConversation()
    }).catch(() => undefined);
  }, [currentView, connectionStatus, pairingCode, settings.displayName, settings.localPeerId]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    const unlisteners = [
      listen<string>("kuno:navigate", (event) => {
        if (event.payload === "settings" || event.payload === "pairing" || event.payload === "main" || event.payload === "mini") {
          setView(event.payload);
        }
      }),
      listen("kuno:pick-files", () => {
        void handlePickFiles();
        setView("main");
      }),
      listen("kuno:send-clipboard", () => {
        setView("main");
      }),
      listen<AutoConnectPayload>("kuno:auto-connect", (event) => {
        if (useChatStore.getState().connectionStatus === "connected") {
          return;
        }
        setDetectedPeers((peers) => upsertDetectedPeer(peers, event.payload));
      }),
      listen<ConnectionRequestPayload>("kuno:connection-request", (event) => {
        autoAcceptConnectionRequest(event.payload);
        setDiagnostic({
          tone: "info",
          title: "接続しました",
          detail: `${event.payload.requesterName || "相手"} からの接続を自動承認しました。`
        });
        setView("main");
      }),
      listen<NativeTransferEvent>("kuno:native-transfer", (event) => {
        const transfer = event.payload;
        if (!Number.isSafeInteger(transfer.transferredBytes) || !Number.isSafeInteger(transfer.totalBytes)) {
          return;
        }
        if (transfer.direction === "incoming") {
          realtimeClient.reportNativeIncomingTransfer({
            transferId: transfer.transferId,
            transferredBytes: transfer.transferredBytes,
            phase: transfer.phase,
            message: transfer.message
          });
          return;
        }
        if (transfer.phase === "failed") {
          failTransfer({
            messageId: transfer.messageId,
            transferId: transfer.transferId,
            message: transfer.message ?? "Native transfer failed."
          });
          return;
        }
        const progress = transfer.totalBytes === 0 ? 100 : Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100));
        updateTransferProgress({
          messageId: transfer.messageId,
          transferId: transfer.transferId,
          progress,
          receivedBytes: transfer.transferredBytes
        });
      }),
      listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) {
          return;
        }
        try {
          const parsed = await Promise.all(
            paths.map(async (path, index) => {
              const fallbackName = path.split(/[\\/]/).pop() || `file-${index + 1}`;
              const metadata = await platformAdapter.pathMetadata(path).catch(() => ({
                name: fallbackName,
                size: 0,
                isDir: false
              }));
              const name = metadata.name || fallbackName;
              const isFolder = metadata.isDir;
              const mime = isFolder ? "application/x-directory" : platformAdapter.inferMime(name);
              const previewUrl = platformAdapter.filePreviewUrl(path, mime);
              return {
                id: `drop_native_${crypto.randomUUID()}`,
                kind: mime.startsWith("image/") ? "image" : "file",
                name,
                size: metadata.size,
                mime,
                localPath: path,
                previewUrl,
                isFolder
              } as DraftAttachment;
            })
          );
          addAttachments(parsed);
        } catch (err) {
          console.error("Native drag-drop processing failed:", err);
        } finally {
          setDraggingOver(false);
        }
      }),
      listen("tauri://drag-over", () => {
        setDraggingOver(true);
      }),
      listen("tauri://drag-leave", () => {
        setDraggingOver(false);
      }),
      listen("tauri://drag-drop-cancelled", () => {
        setDraggingOver(false);
      })
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => callbacks.forEach((unlisten) => unlisten()));
    };
  }, []);

  async function handlePickFiles() {
    const pickedFiles = await platformAdapter.pickFiles();
    addAttachments(
      pickedFiles.map((file) => ({
        id: file.id,
        kind: file.mime.startsWith("image/") ? "image" : "file",
        name: file.name,
        size: file.size,
        mime: file.mime,
        localPath: file.localPath,
        previewUrl: file.previewUrl
      }))
    );
  }

  async function handlePickSaveFolder() {
    const folder = await platformAdapter.pickFolder();
    if (folder) {
      updateSettings({ saveFolder: folder });
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingOver(false);

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) {
      return;
    }

    addAttachments(parseDroppedFiles(droppedFiles));
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDraggingOver(false);
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const pastedAttachments = parseClipboardItems(event.clipboardData.items);
    if (pastedAttachments.length > 0) {
      event.preventDefault();
      addAttachments(pastedAttachments);
    }
  }

  function handleSettingsChange(nextSettings: Partial<typeof settings>) {
    updateSettings(nextSettings);
    if (typeof nextSettings.alwaysOnTop === "boolean") {
      void platformAdapter.setAlwaysOnTop(nextSettings.alwaysOnTop);
    }
    if (typeof nextSettings.launchAtLogin === "boolean") {
      void platformAdapter.setAutostart(nextSettings.launchAtLogin);
    }
  }

  function handleForgetPeer() {
    realtimeClient.disconnect();
    updateSettings({
      trustedPeer: undefined,
      peerDisplayName: undefined,
      pairedRoomId: undefined
    });
    setConnectionStatus("pairing");
    setDiagnostic({
      tone: "info",
      title: "ペアリングをリセットしました",
      detail: "相手PCを確認してから、もう一度Pairで接続してください。"
    });
    setView("pairing");
  }

  function markUnreadAsRead() {
    unreadEpochRef.current += 1;
    if (useChatStore.getState().unreadCount > 0) {
      clearUnread();
    }
  }

  function trustedPeerForActiveConversation(): TrustedPeer | undefined {
    return trustedPeerForConversation(useChatStore.getState().activeConversationId);
  }

  function trustedPeerForConversation(conversationId: string): TrustedPeer | undefined {
    const state = useChatStore.getState();
    return state.conversations.find((conversation) => conversation.id === conversationId)?.trustedPeer ?? state.settings.trustedPeer;
  }

  async function attentionIsNeeded(): Promise<boolean> {
    const epoch = unreadEpochRef.current;
    const miniMode = useChatStore.getState().currentView === "mini";
    const needsAttention = miniMode || await platformAdapter.needsUnreadAttention();
    if (!needsAttention || epoch !== unreadEpochRef.current) {
      return false;
    }
    return true;
  }

  async function notifyIncoming(title: string, body: string) {
    if (!await attentionIsNeeded() || !settingsRef.current.notifications) {
      return;
    }
    await platformAdapter.showNotification({ title, body }).catch(() => undefined);
  }

  function handleOpenMain() {
    markUnreadAsRead();
    setView("main");
  }

  async function resumeRecoveredTransfers() {
    if (!recoveryLoadedRef.current || recoveredTransfersRef.current || !realtimeClient.isReady()) {
      return;
    }
    recoveredTransfersRef.current = true;
    const state = useChatStore.getState();
    for (const session of recoverySessionsRef.current) {
      if (session.direction !== "outgoing" || session.status === "failed") {
        continue;
      }
      const message = state.messages.find((candidate) => candidate.id === session.messageId && candidate.sender === "me");
      const asset = message?.asset?.transferId === session.transferId
        ? message.asset
        : message?.bundle?.items.find((candidate) => candidate.transferId === session.transferId);
      const sourcePath = session.sourcePath ?? asset?.localPath;
      if (!message || !asset || !sourcePath || asset.isFolder) {
        state.failTransfer({
          messageId: session.messageId,
          transferId: session.transferId,
          message: "再開に必要なローカルファイルを開けません。ファイルを選び直して再送してください。"
        });
        continue;
      }

      try {
        const resumedAsset = {
          ...asset,
          localPath: sourcePath,
          size: session.expectedSize,
          sha256: session.sha256 ?? asset.sha256
        };
        await realtimeClient.sendAsset(
          toRealtimeAssetMeta(message, resumedAsset),
          await platformAdapter.createNativeBinarySource(sourcePath, session.expectedSize),
          { sha256: sha256ForAsset(resumedAsset) }
        );
        state.markMessageStatus(session.messageId, "queued");
      } catch (error) {
        state.failTransfer({
          messageId: session.messageId,
          transferId: session.transferId,
          message: error instanceof Error ? error.message : "転送の再開に失敗しました。"
        });
      }
    }
  }

  function handleConnect(friendCode: string) {
    const normalizedCode = friendCode.replace(/\D/g, "");
    if (normalizedCode.length < 6) {
      return;
    }

    if (!runtimeConfig.signalingConfigured) {
      setConnectionStatus("failed");
      return;
    }

    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }
    if (useChatStore.getState().connectionStatus === "connected") {
      realtimeClient.disconnect();
    }
    const selectedPeer = lastAutoConnect;
    const detectedPeerUrl = selectedPeer?.peerHint ? signalingUrlForPeer(selectedPeer.peerHint) : undefined;
    if (selectedPeer) {
      activateConversation({
        peerId: selectedPeer.peerHint,
        displayName: selectedPeer.deviceName || selectedPeer.peerHint,
        peerHint: selectedPeer.peerHint,
        source: selectedPeer.source,
        platform: selectedPeer.platform
      });
      setLastAutoConnect({
        ...selectedPeer,
        roomId: normalizedCode,
        mode: "join",
        signalingUrl: detectedPeerUrl ?? selectedPeer.signalingUrl
      });
    }

    void realtimeClient.connect({
      roomId: normalizedCode,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "join",
      signalingUrl: detectedPeerUrl,
      nativeEndpoint: selectedPeer?.peerHint ? nativeEndpointForPeer(selectedPeer.peerHint) : undefined,
      trustedPeer: trustedPeerForActiveConversation()
    }).catch(() => undefined);
  }

  async function handleConnectDetectedPeer(peer: DetectedPeer) {
    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }
    const roomId = createPairingCode();
    const signalingUrl = signalingUrlForPeer(peer.peerHint) ?? peer.signalingUrl;
    const requestId = crypto.randomUUID();
    const requestPeer = {
      ...peer,
      roomId,
      mode: "join" as const,
      signalingUrl
    };

    if (useChatStore.getState().connectionStatus === "connected") {
      realtimeClient.disconnect();
    }

    activateConversation({
      peerId: peer.peerHint,
      displayName: peer.deviceName || peer.peerHint,
      peerHint: peer.peerHint,
      source: peer.source,
      platform: peer.platform
    });
    setLastAutoConnect(peer);
    setDiagnostic({
      tone: "info",
      title: "接続依頼を送信中",
      detail: `${peer.deviceName || peer.peerHint} に接続依頼を送っています。`
    });
    setView("main");

    try {
      await sendConnectionRequest(signalingUrl, {
        requestId,
        roomId,
        requesterName: settings.displayName || "You",
        requesterPeerId: settings.localPeerId
      });
      setLastAutoConnect(requestPeer);
      setDiagnostic({
        tone: "info",
        title: "承認待ち",
        detail: `${peer.deviceName || peer.peerHint} 側で接続を承認してください。`
      });
      void realtimeClient.connect({
        roomId,
        localPeerId: sessionPeerId,
        displayName: settings.displayName || "You",
        mode: "join",
        signalingUrl,
        nativeEndpoint: nativeEndpointForPeer(peer.peerHint),
        trustedPeer: trustedPeerForConversation(useChatStore.getState().activeConversationId)
      }).catch(() => undefined);
    } catch (error) {
      setConnectionStatus("failed");
      setDiagnostic({
        tone: "danger",
        title: "接続依頼を送れません",
        detail: error instanceof Error ? error.message : "相手のKunoChatに接続依頼を送れませんでした。"
      });
    }
  }

  function handleRetryAutoConnect() {
    const sessionPeerId = sessionPeerIdRef.current;
    const payload = lastAutoConnect;
    if (!sessionPeerId || !payload) {
      setView("pairing");
      return;
    }

    void realtimeClient.connect({
      roomId: payload.roomId,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: payload.mode,
      signalingUrl: payload.signalingUrl,
      nativeEndpoint: nativeEndpointForPeer(payload.peerHint),
      trustedPeer: trustedPeerForConversation(useChatStore.getState().activeConversationId)
    }).catch(() => undefined);
  }

  function handleSelectConversation(conversationId: string) {
    const previousConversationId = useChatStore.getState().activeConversationId;
    const wasConnected = useChatStore.getState().connectionStatus === "connected";
    selectConversation(conversationId);

    const conversation = useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation || conversationId === previousConversationId) {
      return;
    }

    if (wasConnected) {
      realtimeClient.disconnect();
      setConnectionStatus("pairing");
    }

    if (conversation.peerHint) {
      void reconnectConversation(conversation);
    }
  }

  async function reconnectConversation(conversation: ConversationSummary) {
    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId || !conversation.peerHint) {
      return;
    }

    const roomId = createPairingCode();
    const signalingUrl = signalingUrlForPeer(conversation.peerHint) ?? runtimeConfig.signalingUrl;
    const reconnectPayload: AutoConnectPayload = {
      signalingUrl,
      roomId,
      mode: "join",
      peerHint: conversation.peerHint,
      source: conversation.source === "tailscale" ? "tailscale" : "lan",
      deviceName: conversation.displayName,
      platform: conversation.platform
    };

    setLastAutoConnect(reconnectPayload);
    setConnectionStatus("connecting");
    setDiagnostic({
      tone: "info",
      title: "接続中",
      detail: `${conversation.displayName} に接続しています。未送信のメッセージは接続後に自動送信されます。`
    });

    try {
      await sendConnectionRequest(signalingUrl, {
        requestId: crypto.randomUUID(),
        roomId,
        requesterName: settings.displayName || "You",
        requesterPeerId: settings.localPeerId
      });
      await realtimeClient.connect({
        roomId,
        localPeerId: sessionPeerId,
        displayName: settings.displayName || "You",
        mode: "join",
        signalingUrl,
        nativeEndpoint: nativeEndpointForPeer(conversation.peerHint),
        trustedPeer: trustedPeerForConversation(conversation.id)
      });
    } catch (error) {
      setConnectionStatus("failed");
      setDiagnostic({
        tone: "warning",
        title: "未接続",
        detail:
          error instanceof Error
            ? error.message
            : "相手がオンラインになったら再接続して、未送信のメッセージを送信します。"
      });
    }
  }

  function autoAcceptConnectionRequest(request: ConnectionRequestPayload) {
    const sessionPeerId = sessionPeerIdRef.current;
    const currentSettings = useChatStore.getState().settings;
    if (!sessionPeerId || request.requesterPeerId === currentSettings.localPeerId) {
      return;
    }

    if (useChatStore.getState().connectionStatus === "connected") {
      realtimeClient.disconnect();
    }

    activateConversation({
      peerId: request.requesterPeerId,
      displayName: request.requesterName || "Peer",
      peerHint: request.peerHint,
      source: "lan"
    });
    setConnectionRequest(undefined);
    setLastAutoConnect({
      signalingUrl: runtimeConfig.signalingUrl,
      roomId: request.roomId,
      mode: "host",
      peerHint: request.peerHint,
      source: "lan",
      deviceName: request.requesterName
    });
    setDiagnostic({
      tone: "info",
      title: "接続しました",
      detail: `${request.requesterName || "相手"} と接続しています。`
    });
    void realtimeClient.connect({
      roomId: request.roomId,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "host",
      signalingUrl: runtimeConfig.signalingUrl,
      nativeEndpoint: nativeEndpointForPeer(request.peerHint),
      trustedPeer: trustedPeerForActiveConversation()
    }).catch(() => undefined);
  }

  function handleAcceptConnectionRequest() {
    if (connectionRequest) {
      autoAcceptConnectionRequest(connectionRequest);
    }
  }

  function handleDeclineConnectionRequest() {
    setConnectionRequest(undefined);
    setDiagnostic(undefined);
  }

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activeMessages = messages.filter((message) => (message.conversationId ?? DEFAULT_CONVERSATION_ID) === activeConversationId);
  const peerName = activeConversation?.displayName ?? settings.peerDisplayName ?? (connectionStatus === "connected" ? "Peer" : "未接続");
  const composerDisabled = false;

  function handleDraftChange(value: string) {
    setDraftText(value);
    if (connectionStatus !== "connected") {
      return;
    }

    try {
      realtimeClient.sendTyping(value.trim().length > 0);
      window.clearTimeout(typingStopTimerRef.current);
      if (value.trim().length > 0) {
        typingStopTimerRef.current = window.setTimeout(() => realtimeClient.sendTyping(false), 1200);
      }
    } catch {
      // Typing indicators are best-effort and should never block the composer.
    }
  }

  function handleComposerBlur() {
    if (useChatStore.getState().connectionStatus !== "connected") {
      return;
    }
    window.clearTimeout(typingStopTimerRef.current);
    try {
      realtimeClient.sendTyping(false);
    } catch {
      // Typing state is opportunistic and must not affect the editor.
    }
  }

  async function handleSendDraft() {
    await sendDraft(async (message) => {
      await sendRealtimeMessage(message);
    });
    await kickActiveConversationDelivery();
  }

  async function kickActiveConversationDelivery() {
    const state = useChatStore.getState();
    if (state.connectionStatus === "connected") {
      await flushPendingConnectionMessages();
      return;
    }
    if (state.connectionStatus === "connecting" || state.connectionStatus === "reconnecting") {
      return;
    }

    const conversation = state.conversations.find((candidate) => candidate.id === state.activeConversationId);
    if (conversation?.peerHint) {
      void reconnectConversation(conversation);
    }
  }

  async function handleRetryMessage(messageId: string) {
    await retryMessage(messageId, async (message) => {
      await sendRealtimeMessage(message);
    });
  }

  async function flushPendingConnectionMessages() {
    const state = useChatStore.getState();
    const pendingMessages = state.messages.filter(
      (message) =>
        message.sender === "me" &&
        message.status === "queued" &&
        message.error?.code === "pending_connection" &&
        (message.conversationId ?? DEFAULT_CONVERSATION_ID) === state.activeConversationId
    );

    for (const message of pendingMessages) {
      if (pendingDeliveryIdsRef.current.has(message.id)) {
        continue;
      }
      pendingDeliveryIdsRef.current.add(message.id);
      try {
        await retryMessage(message.id, async (retryingMessage) => {
          await sendRealtimeMessage(retryingMessage);
        });
      } finally {
        pendingDeliveryIdsRef.current.delete(message.id);
      }
    }
  }

  function handleCancelMessage(messageId: string) {
    cancelMessage(messageId, (message, transferIds) => {
      for (const transferId of transferIds) {
        realtimeClient.cancelTransfer(message.id, transferId);
      }
    });
  }

  function handlePauseMessage(messageId: string) {
    const message = useChatStore.getState().messages.find((m) => m.id === messageId);
    if (!message) return;
    const transferIds = message.asset ? [message.asset.transferId] : (message.bundle?.items.map((i) => i.transferId) ?? []);
    for (const transferId of transferIds) {
      realtimeClient.pauseTransfer(messageId, transferId);
    }
    markMessageStatus(messageId, "queued");
  }

  function handleResumeMessage(messageId: string) {
    const message = useChatStore.getState().messages.find((m) => m.id === messageId);
    if (!message) return;
    const transferIds = message.asset ? [message.asset.transferId] : (message.bundle?.items.map((i) => i.transferId) ?? []);
    for (const transferId of transferIds) {
      realtimeClient.resumeTransfer(messageId, transferId);
    }
    markMessageStatus(messageId, "sending");
  }

  return (
    <WindowShell
      mode={currentView}
      connectionState={connectionStatus}
      unreadCount={unreadCount}
      activeTransferCount={messages.filter((message) => message.status === "sending").length}
      onOpenMain={handleOpenMain}
    >
      {currentView === "pairing" ? (
        <PairingScreen
          status={connectionStatus}
          signalingConfigured={runtimeConfig.signalingConfigured}
          pairingCode={pairingCode}
          signalingUrl={runtimeConfig.signalingUrl}
          displayName={settings.displayName || "You"}
          peerDisplayName={peerName}
          detectedPeers={detectedPeers}
          selectedPeerId={lastAutoConnect ? detectedPeerId(lastAutoConnect) : undefined}
          onBack={() => setView("main")}
          onConnect={handleConnect}
          onConnectDetectedPeer={handleConnectDetectedPeer}
        />
      ) : null}

      {currentView === "settings" ? (
        <SettingsScreen
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setView("main")}
          onPickSaveFolder={handlePickSaveFolder}
          onClearHistory={clearHistory}
          onForgetPeer={handleForgetPeer}
        />
      ) : null}

      {currentView === "history" ? (
        <HistoryTab />
      ) : null}

      {currentView === "main" ? (
        <div
          className="relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
        >
          <Header
            status={connectionStatus}
            peerName={peerName}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSettings={() => setView("settings")}
            onHistory={() => setView("history")}
            onMini={() => setView("mini")}
            onPair={() => setView("pairing")}
            onSelectConversation={handleSelectConversation}
          />
          <ConnectionRequestBanner
            request={connectionRequest}
            onAccept={handleAcceptConnectionRequest}
            onDecline={handleDeclineConnectionRequest}
          />
          <ConnectionBanner
            diagnostic={diagnostic}
            status={connectionStatus}
            onPair={() => setView("pairing")}
            onRetry={handleRetryAutoConnect}
          />
          <MessageList
            messages={activeMessages}
            connectionStatus={connectionStatus}
            peerName={peerName}
            showTyping={peerTyping}
            onRetryMessage={(messageId) => void handleRetryMessage(messageId)}
            onCancelMessage={handleCancelMessage}
            onPauseMessage={handlePauseMessage}
            onResumeMessage={handleResumeMessage}
            onDownload={requestDownload}
            onPair={() => setView("pairing")}
          />
          <DropOverlay visible={isDraggingOver} />
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
          <Composer
            value={draftText}
            hasAttachments={attachments.length > 0}
            disabled={composerDisabled}
            onChange={handleDraftChange}
            onSend={() => void handleSendDraft()}
            onPickFiles={handlePickFiles}
            onBlur={handleComposerBlur}
          />
        </div>
      ) : null}
    </WindowShell>
  );
}

async function sendRealtimeMessage(message: ChatMessage) {
  if (message.kind === "text" && message.text) {
    realtimeClient.sendText({
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      createdAt: message.createdAt,
      text: message.text.text
    });
    return;
  }

  if ((message.kind === "file" || message.kind === "image") && message.asset) {
    let localPath = message.asset.localPath;
    let size = message.asset.size;
    let name = message.asset.name;
    let mime = message.asset.mime;

    if (message.asset.isFolder) {
      try {
        const zipMeta = await platformAdapter.zipDirectory(message.asset.localPath!);
        if (zipMeta.localPath) {
          localPath = zipMeta.localPath;
          size = zipMeta.size;
          name = zipMeta.name;
          mime = "application/zip";
        }
      } catch (err) {
        console.error("Failed to zip directory:", err);
        throw new Error("フォルダの圧縮に失敗しました。");
      }
    }

    const modifiedAsset = {
      ...message.asset,
      localPath,
      size,
      name,
      mime
    };

    const sha256 = sha256ForAsset(modifiedAsset);
    // A preview must never delay the asset-start control message. Native images
    // are previewed after receipt; browser Files may already carry a thumbnail.
    const thumbnail = modifiedAsset.thumbnail;

    await realtimeClient.sendAsset(
      {
        id: modifiedAsset.id,
        messageId: message.id,
        transferId: modifiedAsset.transferId,
        senderId: message.senderId,
        senderName: message.senderName,
        createdAt: message.createdAt,
        kind: modifiedAsset.kind,
        name: modifiedAsset.name,
        size: modifiedAsset.size,
        mime: modifiedAsset.mime,
        thumbnail,
        isFolder: message.asset.isFolder
      },
      await createBinarySource(modifiedAsset),
      { sha256 }
    );
    return;
  }

  if (message.kind === "bundle" && message.bundle) {
    for (const item of message.bundle.items) {
      let localPath = item.localPath;
      let size = item.size;
      let name = item.name;
      let mime = item.mime;

      if (item.isFolder) {
        try {
          const zipMeta = await platformAdapter.zipDirectory(item.localPath!);
          if (zipMeta.localPath) {
            localPath = zipMeta.localPath;
            size = zipMeta.size;
            name = zipMeta.name;
            mime = "application/zip";
          }
        } catch (err) {
          console.error("Failed to zip directory in bundle:", err);
          throw new Error(`フォルダ ${item.name} の圧縮に失敗しました。`);
        }
      }

      const modifiedItem = {
        ...item,
        localPath,
        size,
        name,
        mime
      };

      const sha256 = sha256ForAsset(modifiedItem);
      const thumbnail = modifiedItem.thumbnail;

      await realtimeClient.sendAsset(
        {
          id: modifiedItem.id,
          messageId: message.id,
          transferId: modifiedItem.transferId,
          senderId: message.senderId,
          senderName: message.senderName,
          createdAt: message.createdAt,
          kind: modifiedItem.kind,
          name: modifiedItem.name,
          size: modifiedItem.size,
          mime: modifiedItem.mime,
          caption: message.bundle.caption,
          thumbnail,
          isFolder: item.isFolder
        },
        await createBinarySource(modifiedItem),
        { sha256 }
      );
    }
    return;
  }

  throw new Error("This message does not contain a readable payload.");
}

function toRealtimeAssetMeta(
  message: ChatMessage,
  asset: NonNullable<ChatMessage["asset"]> | NonNullable<ChatMessage["bundle"]>["items"][number]
): RealtimeAssetMeta {
  return {
    id: asset.id,
    messageId: message.id,
    transferId: asset.transferId,
    senderId: message.senderId,
    senderName: message.senderName,
    createdAt: message.createdAt,
    kind: asset.kind,
    name: asset.name,
    size: asset.size,
    mime: asset.mime,
    sha256: asset.sha256,
    caption: message.bundle?.caption,
    thumbnail: asset.thumbnail,
    isFolder: asset.isFolder
  };
}

async function createBinarySource(asset: NonNullable<ChatMessage["asset"]> | NonNullable<ChatMessage["bundle"]>["items"][number]): Promise<File | RealtimeBinarySource> {
  if (asset.file) {
    return asset.file;
  }

  if (!asset.localPath) {
    throw new Error(`${asset.name} is not readable from this session.`);
  }

  return platformAdapter.createNativeBinarySource(asset.localPath, asset.size);
}

async function persistReceivedAsset(
  input: { id: string; transferId: string; objectUrl: string; blob: Blob; meta: RealtimeAssetMeta },
  completeTransfer: (payload: { messageId: string; transferId: string; objectUrl?: string; savePath?: string; sha256?: string }) => void,
  failTransfer: (payload: { messageId: string; transferId: string; message: string }) => void
) {
  try {
    const bytes = await input.blob.arrayBuffer();
    if (input.meta.sha256) {
      const actualHash = await sha256ArrayBuffer(bytes);
      if (actualHash !== input.meta.sha256) {
        throw new Error("ファイルの整合性チェックに失敗しました。保存せず破棄しました。");
      }
    }
    const savePath = await platformAdapter.saveReceivedFile(input.meta.name, bytes);
    if (savePath) {
      let finalSavePath = savePath;
      if (input.meta.isFolder) {
        try {
          const folderPath = savePath.replace(/\.zip$/i, "");
          await platformAdapter.unzipFile(savePath, folderPath);
          finalSavePath = folderPath;
        } catch (err) {
          console.error("Failed to unzip folder:", err);
          throw new Error("受信したフォルダの解凍に失敗しました。");
        }
      }

      completeTransfer({
        messageId: input.id,
        transferId: input.transferId,
        objectUrl: input.objectUrl,
        savePath: finalSavePath,
        sha256: input.meta.sha256
      });
      await platformAdapter.showNotification({
        title: "KunoChat",
        body: `${input.meta.name.replace(/\.zip$/i, "")} を保存しました`
      });
    }
  } catch (error) {
    failTransfer({
      messageId: input.id,
      transferId: input.transferId,
      message: error instanceof Error ? error.message : "受信ファイルを保存できませんでした。"
    });
  }
}

function connectionHelpText(message: string): string {
  if (/timed out|Cannot reach/i.test(message)) {
    return "同じWi-Fi/LANにいるか、OSのファイアウォールでKunoChatを許可しているか確認してください。";
  }
  if (/room/i.test(message)) {
    return "この接続ルームはすでに使用中です。相手PCだけが開いている状態で再試行してください。";
  }
  return message || "相手PC、ネットワーク、ファイアウォール設定を確認してください。";
}

async function sendConnectionRequest(
  signalingUrl: string,
  payload: { requestId: string; roomId: string; requesterName: string; requesterPeerId: string }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(signalingUrl);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error(`Cannot reach KunoChat at ${signalingUrl}.`));
    }, 5000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "connection-request", ...payload }));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; message?: string };
      if (message.type === "connection-request-ack") {
        window.clearTimeout(timer);
        socket.close();
        resolve();
      } else if (message.type === "error") {
        window.clearTimeout(timer);
        socket.close();
        reject(new Error(message.message || "Connection request was rejected by the peer."));
      }
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Cannot reach KunoChat at ${signalingUrl}.`));
    };
  });
}

function ConnectionRequestBanner({
  request,
  onAccept,
  onDecline
}: {
  request?: ConnectionRequestPayload;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (!request) {
    return null;
  }

  return (
    <div className="mx-3 mt-3 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-card border border-accent/30 bg-accent-soft px-3 py-2.5 text-text" role="status">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">接続依頼</div>
          <div className="mt-0.5 break-words text-[11px] leading-4 text-muted">
            {request.requesterName || "相手"} が接続を求めています。
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onDecline} className="kuno-focus-ring rounded-input bg-white/80 px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
            Decline
          </button>
          <button type="button" onClick={onAccept} className="kuno-focus-ring rounded-input bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover">
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({
  diagnostic,
  status,
  onPair,
  onRetry
}: {
  diagnostic?: ConnectionDiagnostic;
  status: ConnectionStatus;
  onPair: () => void;
  onRetry: () => void;
}) {
  if (!diagnostic && status === "connected") {
    return null;
  }

  const activeDiagnostic = diagnostic ?? reconnectDiagnostic(status);
  const toneClass =
    activeDiagnostic.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200"
      : activeDiagnostic.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100"
        : "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-950/30 dark:text-blue-100";

  return (
    <div className={`mx-3 mt-3 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-card border px-3 py-2.5 ${toneClass}`} role="status">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">{activeDiagnostic.title}</div>
          <div className="mt-0.5 break-words text-[11px] leading-4 opacity-90">{activeDiagnostic.detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onRetry} className="kuno-focus-ring rounded-input bg-white/80 px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
            再接続
          </button>
          <button type="button" onClick={onPair} className="kuno-focus-ring rounded-input bg-white/80 px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
            接続先を選ぶ
          </button>
        </div>
      </div>
    </div>
  );
}

function reconnectDiagnostic(status: ConnectionStatus): ConnectionDiagnostic {
  if (status === "connecting" || status === "reconnecting") {
    return {
      tone: "warning",
      title: "再接続中",
      detail: "前回の接続先へ接続しています。別の相手に繋ぐ場合は「接続先を選ぶ」を押してください。"
    };
  }
  if (status === "failed" || status === "offline") {
    return {
      tone: "warning",
      title: "接続が切れています",
      detail: "同じ相手へ戻すなら「再接続」、別のPCへ繋ぐなら「接続先を選ぶ」を押してください。"
    };
  }
  return {
    tone: "info",
    title: "未接続です",
    detail: "接続先を選ぶか、相手からの接続依頼を待ってください。"
  };
}

function createPairingCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes).reduce((total, byte) => (total * 256 + byte) % 1_000_000, 0);
  return value.toString().padStart(6, "0").replace(/(\d{3})(\d{3})/, "$1-$2");
}
