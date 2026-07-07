import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { Composer } from "../components/Composer";
import { DropOverlay } from "../components/DropOverlay";
import { Header } from "../components/Header";
import { MessageList } from "../components/MessageList";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { PairingScreen } from "../components/PairingScreen";
import { SettingsScreen } from "../components/SettingsScreen";
import { WindowShell } from "../components/WindowShell";
import { HistoryTab } from "../components/HistoryTab";
import { DEFAULT_CONVERSATION_ID, selectPendingConnectionMessages, selectUnackedTextMessages, useChatStore } from "../features/chat/chatStore";
import { runtimeConfig } from "../features/config/runtimeConfig";
import type { ChatMessage, ConnectionStatus, ConversationSummary, DraftAttachment, TrustedPeer } from "../features/chat/messageTypes";
import { platformAdapter, type DurableTransferSession } from "../features/native/platformAdapter";
import { realtimeClient, webrtcSizeLimitExceeded } from "../features/realtime/realtimeClient";
import type { RealtimeAssetMeta, RealtimeBinarySource, RealtimeConnectOptions } from "../features/realtime/realtimeTypes";
import { roleForPair, roomIdForPair } from "../features/realtime/pairing";
import { createConnectGuard } from "../features/chat/connectGuard";
import { deviceKeyForPeer, selectAutoPairTarget, selectAutoSwitchTarget } from "../features/chat/autoConnect";
import { isTailscaleAddress } from "../features/net/address";
import { peerReachabilitySummary } from "../features/diagnostics/diagnosticsService";
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
  /** false = the peer's device is online but its KunoChat port did not answer. */
  reachable?: boolean;
};

const LOCAL_BROWSER_SIGNALING_URL = "browser-local";
const CONNECTION_ATTEMPT_TIMEOUT_MS = 16_000;
const BACKGROUND_RECONNECT_INTERVAL_MS = 20_000;
// Minimum spacing between AUTO pairing attempts to the same device.
const AUTO_PAIR_RETRY_MS = 60_000;

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

function signalingUrlForDetectedPeer(peer: AutoConnectPayload): string | undefined {
  if (peer.signalingUrl === LOCAL_BROWSER_SIGNALING_URL) {
    return LOCAL_BROWSER_SIGNALING_URL;
  }
  if (peer.mode === "join") {
    return peer.signalingUrl;
  }
  return signalingUrlForPeer(peer.peerHint) ?? peer.signalingUrl;
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
  requesterRole?: "host" | "join" | null;
};

type ConnectionDiagnostic = {
  tone: "info" | "warning" | "danger";
  title: string;
  detail: string;
  /** Skip auto-wait sanitization; the detail is already user-actionable. */
  sticky?: boolean;
};

type ConnectionFailure = {
  reason: string;
  at: number;
};

export function App() {
  const {
    currentView,
    connectionStatus,
    activeConversationId,
    conversations,
    messages,
    deliveryOutbox,
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
    setConversationStablePeerId,
    adoptConversationIdentity,
    registerConversation,
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
  const connectGuardRef = useRef(createConnectGuard());
  const boundConversationIdRef = useRef<string>();
  const lastAutoConnectRef = useRef<AutoConnectPayload>();
  const detectedPeersRef = useRef<DetectedPeer[]>([]);
  const autoPairAttemptAtRef = useRef(new Map<string, number>());
  const typingStopTimerRef = useRef<number>();
  const connectionTimeoutRef = useRef<number>();
  const settingsRef = useRef(settings);
  const windowFocusedRef = useRef(typeof document === "undefined" ? true : document.hasFocus());
  const unreadEpochRef = useRef(0);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic>();
  const [lastConnectionFailure, setLastConnectionFailure] = useState<ConnectionFailure>();
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

  // Keep a ref copy of lastAutoConnect so the once-registered connection-request
  // listener (autoAcceptConnectionRequest) reads the current value, not a stale
  // closure snapshot.
  useEffect(() => {
    lastAutoConnectRef.current = lastAutoConnect;
  }, [lastAutoConnect]);

  // The auto-connect engine (fired from interval/listener closures) reads the
  // peer list from this ref to avoid a stale closure over React state.
  useEffect(() => {
    detectedPeersRef.current = detectedPeers;
  }, [detectedPeers]);

  // Every dial path must set the ref SYNCHRONOUSLY (not one render behind), or the
  // acceptor-side glare guard compares against a stale room and tears down the
  // connection being established. Use this instead of bare setLastAutoConnect on
  // dial paths.
  function applyLastAutoConnect(payload: AutoConnectPayload) {
    lastAutoConnectRef.current = payload;
    setLastAutoConnect(payload);
  }

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
    const recoverConnection = () => {
      const status = useChatStore.getState().connectionStatus;
      if (ensureActiveConversationConnection("resume")) {
        return;
      }
      if (status !== "connected" && lastAutoConnect) {
        handleRetryAutoConnect();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverConnection();
      }
    };
    window.addEventListener("online", recoverConnection);
    window.addEventListener("focus", recoverConnection);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", recoverConnection);
      window.removeEventListener("focus", recoverConnection);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [lastAutoConnect]);

  useEffect(() => {
    if (currentView === "main") {
      runAutoConnectTick("open");
    }
  }, [currentView, activeConversationId, connectionStatus, conversations]);

  // Background reconnect worker: while offline, keep the auto-connect engine
  // ticking on a slow cadence so recovery does not depend on the user focusing
  // the window or pressing a button.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useChatStore.getState();
      if (state.currentView !== "main" && state.currentView !== "mini") {
        return;
      }
      if (state.connectionStatus === "offline" || state.connectionStatus === "failed" || state.connectionStatus === "pairing") {
        runAutoConnectTick("resume");
      }
    }, BACKGROUND_RECONNECT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

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
          markInterruptedTransfers("相手がオフラインです。再接続後に再送できます。");
          setDiagnostic({
            tone: "warning",
            title: "相手がオフラインです",
            detail: "相手のKunoChatが開いているか確認してください。"
          });
        }
      },
      onPeer: (peer) => {
        updateSettings({ peerDisplayName: peer.displayName });
        const state = useChatStore.getState();
        const active = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
        if (!active || (active.id === DEFAULT_CONVERSATION_ID && !active.peerHint)) {
          activateConversation({
            peerId: peer.peerId,
            displayName: peer.displayName
          });
        }
      },
      onIdentity: (identity) => {
        if (identity.status === "mismatch") {
          setDiagnostic({
            tone: "danger",
            title: "相手PCの確認に失敗しました",
            detail: "以前ペアリングしたデバイスと一致しません。相手PCを確認してから再ペアリングしてください。"
          });
          return;
        }
        const boundConversationId = boundConversationIdRef.current ?? useChatStore.getState().activeConversationId;
        const trustedPeer: TrustedPeer = {
          publicKey: identity.publicKey,
          fingerprint: identity.fingerprint,
          verifiedAt: Date.now()
        };
        setConversationTrustedPeer(boundConversationId, trustedPeer);
        // Learn the peer's stable id so future reconnects derive a deterministic
        // room even if their IP changes, and fold any split IP-keyed tabs into one.
        if (identity.stablePeerId) {
          setConversationStablePeerId(boundConversationId, identity.stablePeerId);
        }
        adoptConversationIdentity(boundConversationId, trustedPeer);
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
          caption: asset.caption,
          thumbnail: asset.thumbnail,
          isFolder: asset.isFolder
        });
        // Reject an oversized WebRTC-only transfer before we start accumulating it
        // in renderer memory (would OOM-crash the window).
        if (webrtcSizeLimitExceeded(asset.size, Boolean(asset.nativeKey))) {
          failTransfer({
            messageId: asset.messageId,
            transferId: asset.transferId,
            message: "このサイズはネイティブ転送が必要です。両端末のKunoChatを最新にして再試行してください。"
          });
          return;
        }
        if (isNewMessage) {
          void notifyIncoming(`${asset.senderName} がファイルを送信しました`, asset.name);
        }
        // Skip re-download if this exact transfer was already saved (e.g. a bundle
        // retry after our own restart cleared incomingRequestsRef). Prevents
        // duplicate files on disk.
        if (alreadySavedTransfer(asset.messageId, asset.transferId)) {
          incomingRequestsRef.current.add(asset.transferId);
          return;
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
        recordConnectionFailure(message);
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
      window.clearTimeout(connectionTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(connectionTimeoutRef.current);
    if (connectionStatus !== "connecting" && connectionStatus !== "reconnecting") {
      return;
    }

    connectionTimeoutRef.current = window.setTimeout(() => {
      const latestStatus = useChatStore.getState().connectionStatus;
      if (latestStatus !== "connecting" && latestStatus !== "reconnecting") {
        return;
      }
      setConnectionStatus("failed");
      markInterruptedTransfers("接続が時間切れになりました。相手を選び直すか、もう一度接続してください。");
      recordConnectionFailure("接続が時間切れになりました。");
      setDiagnostic({
        tone: "danger",
        title: "接続が完了しません",
        detail: "相手PCが見つからないか、接続の応答がありません。接続先を選び直してください。"
      });
    }, CONNECTION_ATTEMPT_TIMEOUT_MS);

    return () => window.clearTimeout(connectionTimeoutRef.current);
  }, [connectionStatus, markInterruptedTransfers, setConnectionStatus]);

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

    void connectRealtime(useChatStore.getState().activeConversationId, {
      roomId: pairingCode,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "host",
      trustedPeer: trustedPeerForActiveConversation()
    }).catch(() => undefined);
  }, [currentView, connectionStatus, pairingCode, settings.displayName, settings.localPeerId]);

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window || typeof BroadcastChannel === "undefined" || currentView !== "pairing") {
      return;
    }

    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }

    const channel = new BroadcastChannel("kunochat-browser-discovery");
    const announce = () => {
      channel.postMessage({
        type: "announce",
        peerId: sessionPeerId,
        displayName: settings.displayName || "ブラウザ",
        roomId: pairingCode,
        platform: "browser"
      });
      setDetectedPeers((peers) => peers.filter((peer) => Date.now() - peer.lastSeen < 10_000));
    };

    channel.onmessage = (event) => {
      const message = event.data as { type?: string; peerId?: string; displayName?: string; roomId?: string; platform?: string };
      if (message.type !== "announce" || !message.peerId || !message.roomId || message.peerId === sessionPeerId) {
        return;
      }
      const remotePeerId = message.peerId;
      const remoteRoomId = message.roomId;
      setDetectedPeers((peers) =>
        upsertDetectedPeer(peers, {
          signalingUrl: LOCAL_BROWSER_SIGNALING_URL,
          roomId: remoteRoomId,
          mode: "join",
          peerHint: remotePeerId,
          source: "lan",
          deviceName: message.displayName || "ブラウザ",
          platform: message.platform || "browser"
        })
      );
    };

    announce();
    const interval = window.setInterval(announce, 1500);
    return () => {
      window.clearInterval(interval);
      channel.close();
    };
  }, [currentView, pairingCode, settings.displayName]);

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
        const payload = event.payload;
        // Case B: passively register tailnet devices into the conversation list
        // (they are the user's own devices) so Case C can auto-select them. This
        // runs regardless of connection state and never dials on its own.
        if (payload.source === "tailscale") {
          registerConversation({
            peerHint: payload.peerHint,
            displayName: payload.deviceName || payload.peerHint,
            source: "tailscale",
            platform: payload.platform
          });
        }
        // Keep the detected list (state) and the engine's ref in lockstep and
        // fresh even while connected — otherwise the ref goes stale during a long
        // session and the state-sync effect would later clobber any ref-only
        // additions. Only the auto-dial tick is gated on being disconnected.
        setDetectedPeers((peers) => upsertDetectedPeer(peers, payload));
        detectedPeersRef.current = upsertDetectedPeer(detectedPeersRef.current, payload);
        if (useChatStore.getState().connectionStatus === "connected") {
          return;
        }
        runAutoConnectTick("detect");
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
        previewUrl: file.previewUrl,
        file: file.file
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
    if (typeof nextSettings.shortcut === "string") {
      void platformAdapter.setAppShortcut(nextSettings.shortcut);
    }
  }

  function handleForgetPeer() {
    const state = useChatStore.getState();
    realtimeClient.disconnect();
    setConversationTrustedPeer(state.activeConversationId, undefined);
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

  function recordConnectionFailure(reason: string) {
    setLastConnectionFailure({ reason, at: Date.now() });
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

  // Every realtimeClient.connect goes through here so we always record which
  // conversation this transport belongs to (C-5: flush only that conversation's
  // queued messages) and always advertise our stable peer id (C-1/C-3).
  function connectRealtime(conversationId: string, options: Omit<RealtimeConnectOptions, "stableLocalPeerId">) {
    boundConversationIdRef.current = conversationId;
    return realtimeClient.connect({
      ...options,
      stableLocalPeerId: useChatStore.getState().settings.localPeerId
    });
  }

  function ensureActiveConversationConnection(reason: "open" | "resume" | "select" | "send", force = false): boolean {
    const state = useChatStore.getState();
    if (state.connectionStatus === "connected" || state.connectionStatus === "connecting" || state.connectionStatus === "reconnecting") {
      return false;
    }

    const conversation = state.conversations.find((candidate) => candidate.id === state.activeConversationId);
    if (!conversation?.peerHint) {
      return false;
    }

    if (!connectGuardRef.current.begin(conversation.id, { force })) {
      return true;
    }
    void reconnectConversation(conversation, { automatic: true, reason }).finally(() => {
      connectGuardRef.current.end(conversation.id);
    });
    return true;
  }

  // Decides — without any manual peer selection — who to connect to. Called on
  // launch, on every discovery event, and from the 20s background worker.
  // Synchronous: reads getState()/detectedPeersRef and dispatches with no await
  // between the check and the action.
  function runAutoConnectTick(trigger: "open" | "resume" | "detect") {
    const state = useChatStore.getState();
    if (state.currentView !== "main" && state.currentView !== "mini") {
      return;
    }
    if (state.connectionStatus === "connected" || state.connectionStatus === "connecting" || state.connectionStatus === "reconnecting") {
      return;
    }

    const active = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
    if (active?.peerHint) {
      // Active conversation already has a target: existing reconnect path (guarded).
      ensureActiveConversationConnection(trigger === "detect" ? "resume" : trigger);
      return;
    }

    const now = Date.now();
    // Case C: auto-open a known conversation (only when the active one is empty).
    const switchTarget = selectAutoSwitchTarget(state.conversations, detectedPeersRef.current, now);
    if (switchTarget) {
      if (switchTarget.matchedPeer && switchTarget.matchedPeer.peerHint !== switchTarget.conversation.peerHint) {
        // Point the conversation at the freshly detected route before dialing (id unchanged).
        registerConversation({
          peerHint: switchTarget.matchedPeer.peerHint,
          displayName: switchTarget.conversation.displayName,
          source: switchTarget.matchedPeer.source,
          platform: switchTarget.matchedPeer.platform
        });
      }
      handleSelectConversation(switchTarget.conversation.id);
      return;
    }

    // Case A: true first contact — auto-pair only if exactly one device is present.
    const pairTarget = selectAutoPairTarget(detectedPeersRef.current, state.conversations, now);
    if (pairTarget) {
      const key = deviceKeyForPeer(pairTarget);
      const lastAt = autoPairAttemptAtRef.current.get(key) ?? Number.NEGATIVE_INFINITY;
      if (now - lastAt < AUTO_PAIR_RETRY_MS) {
        return;
      }
      autoPairAttemptAtRef.current.set(key, now);
      void handleConnectDetectedPeer(pairTarget, { auto: true });
    }
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
          await platformAdapter.createNativeBinarySource(sourcePath, session.expectedSize, asset.isFolder),
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
      setDiagnostic({
        tone: "danger",
        title: "接続設定が未完了です",
        detail: "シグナリングURLが設定されていないため接続できません。設定を確認してください。"
      });
      return;
    }

    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }
    if (useChatStore.getState().connectionStatus === "connected") {
      realtimeClient.disconnect();
    }
    const selectedPeer = lastAutoConnect ?? detectedPeers.find((peer) => peer.reachable !== false) ?? detectedPeers[0];
    if (!selectedPeer || selectedPeer.signalingUrl === LOCAL_BROWSER_SIGNALING_URL) {
      setConnectionStatus("failed");
      setDiagnostic({
        tone: "danger",
        title: "接続先が見つかりません",
        detail: "6桁コードだけでは相手PCを特定できません。相手のKunoChatを起動し、同じネットワークで「見つかった相手」に表示されてから接続してください。"
      });
      setView("pairing");
      return;
    }
    const detectedPeerUrl = signalingUrlForDetectedPeer(selectedPeer);
    const conversationId = activateConversation({
      peerId: selectedPeer.peerHint,
      displayName: selectedPeer.deviceName || selectedPeer.peerHint,
      peerHint: selectedPeer.peerHint,
      source: selectedPeer.source,
      platform: selectedPeer.platform
    });
    applyLastAutoConnect({
      ...selectedPeer,
      roomId: normalizedCode,
      mode: "join",
      signalingUrl: detectedPeerUrl ?? selectedPeer.signalingUrl
    });

    void connectRealtime(conversationId, {
      roomId: normalizedCode,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "join",
      signalingUrl: detectedPeerUrl,
      nativeEndpoint: selectedPeer.signalingUrl === LOCAL_BROWSER_SIGNALING_URL || !selectedPeer.peerHint ? undefined : nativeEndpointForPeer(selectedPeer.peerHint),
      trustedPeer: trustedPeerForActiveConversation()
    }).catch(() => undefined);
  }

  async function handleConnectDetectedPeer(peer: DetectedPeer, options: { auto?: boolean } = {}) {
    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId) {
      return;
    }

    // Resolve the device to a single conversation (across LAN/Tailscale routes)
    // and update its route BEFORE dialing. Does not switch the active view yet.
    const conversationId = registerConversation({
      peerHint: peer.peerHint,
      displayName: peer.deviceName || peer.peerHint,
      source: peer.source,
      platform: peer.platform
    });

    // Take the single-flight guard first, and bail before any destructive side
    // effect (disconnect/diagnostic/setView) if another dial is already running.
    if (!connectGuardRef.current.begin(conversationId, { force: true })) {
      return;
    }

    try {
      if (useChatStore.getState().connectionStatus === "connected") {
        realtimeClient.disconnect();
      }
      selectConversation(conversationId);
      // An auto-invoked pair must not yank the window out of mini view.
      if (!options.auto || useChatStore.getState().currentView !== "mini") {
        setView("main");
      }

      const isLocalBrowserPeer = peer.signalingUrl === LOCAL_BROWSER_SIGNALING_URL;
      // Discovery already computed a symmetric room id + complementary mode on
      // both machines, so reuse them rather than minting a fresh random room.
      const roomId = peer.roomId;
      const requestUrl = signalingUrlForDetectedPeer(peer) ?? peer.signalingUrl;

      if (isLocalBrowserPeer) {
        applyLastAutoConnect({ ...peer, roomId, mode: "join", signalingUrl: requestUrl });
        setDiagnostic({
          tone: "info",
          title: "接続中",
          detail: `${peer.deviceName || "相手"} に接続しています。`
        });
        await connectRealtime(conversationId, {
          roomId,
          localPeerId: sessionPeerId,
          displayName: settings.displayName || "You",
          mode: "join",
          signalingUrl: requestUrl,
          trustedPeer: trustedPeerForConversation(conversationId)
        }).catch(() => undefined);
        return;
      }

      setDiagnostic({
        tone: "info",
        title: "接続依頼を送信中",
        detail: `${peer.deviceName || peer.peerHint} に接続依頼を送っています。`
      });
      const ack = await sendConnectionRequest(requestUrl, {
        requestId: crypto.randomUUID(),
        roomId,
        requesterName: settings.displayName || "You",
        requesterPeerId: settings.localPeerId,
        requesterRole: peer.mode
      });
      const mode: "host" | "join" = ack.proto >= 2 ? peer.mode : "join";
      const connectSignalingUrl = mode === "host" ? runtimeConfig.signalingUrl : requestUrl;
      applyLastAutoConnect({ ...peer, roomId, mode, signalingUrl: connectSignalingUrl });
      setDiagnostic({
        tone: "info",
        title: "承認待ち",
        detail: `${peer.deviceName || peer.peerHint} 側で接続を承認してください。`
      });
      await connectRealtime(conversationId, {
        roomId,
        localPeerId: sessionPeerId,
        displayName: settings.displayName || "You",
        mode,
        signalingUrl: connectSignalingUrl,
        nativeEndpoint: nativeEndpointForPeer(peer.peerHint),
        trustedPeer: trustedPeerForConversation(conversationId)
      }).catch(() => undefined);
    } catch (error) {
      setConnectionStatus("failed");
      recordConnectionFailure(error instanceof Error ? error.message : "接続依頼を送れませんでした。");
      const unreachableSummary = peer.reachable === false ? peerReachabilitySummary(peer) : undefined;
      setDiagnostic(
        unreachableSummary?.guidance
          ? {
              tone: "warning",
              title: "相手のKunoChatが応答していません",
              detail: unreachableSummary.guidance,
              sticky: true
            }
          : {
              tone: "danger",
              title: "接続依頼を送れません",
              detail: error instanceof Error ? error.message : "相手のKunoChatに接続依頼を送れませんでした。"
            }
      );
    } finally {
      connectGuardRef.current.end(conversationId);
    }
  }

  function handleRetryAutoConnect() {
    const sessionPeerId = sessionPeerIdRef.current;
    const payload = lastAutoConnect;
    if (!sessionPeerId || !payload) {
      setView("pairing");
      return;
    }

    const conversationId = useChatStore.getState().activeConversationId;
    // Share the single-flight guard so a manual retry can't race the background
    // worker or the recovery handlers.
    if (!connectGuardRef.current.begin(conversationId, { force: true })) {
      return;
    }
    void connectRealtime(conversationId, {
      roomId: payload.roomId,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: payload.mode,
      signalingUrl: payload.signalingUrl,
      nativeEndpoint: nativeEndpointForPeer(payload.peerHint),
      trustedPeer: trustedPeerForConversation(conversationId)
    })
      .catch(() => undefined)
      .finally(() => connectGuardRef.current.end(conversationId));
  }

  function handleSelectConversation(conversationId: string) {
    const previousConversationId = useChatStore.getState().activeConversationId;
    const previousStatus = useChatStore.getState().connectionStatus;
    const hadActiveConnection =
      previousStatus === "connected" || previousStatus === "connecting" || previousStatus === "reconnecting";
    selectConversation(conversationId);

    const conversation = useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      return;
    }

    if (conversationId !== previousConversationId && hadActiveConnection) {
      realtimeClient.disconnect();
      setConnectionStatus("pairing");
    }

    if (conversation.peerHint) {
      ensureActiveConversationConnection("select", true);
    }
  }

  async function reconnectConversation(
    conversation: ConversationSummary,
    options: { automatic?: boolean; reason?: "open" | "resume" | "select" | "send" } = {}
  ) {
    const sessionPeerId = sessionPeerIdRef.current;
    if (!sessionPeerId || !conversation.peerHint) {
      return;
    }

    // Deterministic room/role when we already know the peer's stable id: both
    // sides derive the same room and complementary host/join roles, so whoever
    // dials first, they converge (no roomId mismatch / glare stalls).
    const localStableId = settings.localPeerId;
    const stableRemote = conversation.stablePeerId;
    const deterministic = Boolean(stableRemote);
    const roomId = deterministic ? roomIdForPair(localStableId, stableRemote!) : createPairingCode();
    const myRole: "host" | "join" = deterministic ? roleForPair(localStableId, stableRemote!) : "join";
    // The connection-request always goes to the peer's own server.
    const requestUrl = signalingUrlForPeer(conversation.peerHint) ?? runtimeConfig.signalingUrl;

    setConnectionStatus("connecting");
    setDiagnostic({
      tone: "info",
      title: options.automatic ? "自動接続中" : "接続中",
      detail: `${conversation.displayName} が同じチャットを開いていればオンラインになります。未送信のメッセージは接続後に自動送信されます。`
    });

    try {
      const ack = await sendConnectionRequest(requestUrl, {
        requestId: crypto.randomUUID(),
        roomId,
        requesterName: settings.displayName || "You",
        requesterPeerId: settings.localPeerId,
        requesterRole: deterministic ? myRole : undefined
      });
      // Only take the negotiated role if the peer speaks proto>=2; otherwise fall
      // back to the legacy "requester joins, acceptor hosts" flow.
      const mode: "host" | "join" = deterministic && ack.proto >= 2 ? myRole : "join";
      const connectSignalingUrl = mode === "host" ? runtimeConfig.signalingUrl : requestUrl;
      applyLastAutoConnect({
        signalingUrl: connectSignalingUrl,
        roomId,
        mode,
        peerHint: conversation.peerHint,
        source: conversation.source === "tailscale" ? "tailscale" : "lan",
        deviceName: conversation.displayName,
        platform: conversation.platform
      });
      await connectRealtime(conversation.id, {
        roomId,
        localPeerId: sessionPeerId,
        displayName: settings.displayName || "You",
        mode,
        signalingUrl: connectSignalingUrl,
        nativeEndpoint: nativeEndpointForPeer(conversation.peerHint),
        trustedPeer: trustedPeerForConversation(conversation.id)
      });
    } catch (error) {
      setConnectionStatus(options.automatic ? "offline" : "failed");
      recordConnectionFailure(error instanceof Error ? error.message : "接続依頼を送れませんでした。");
      setDiagnostic({
        tone: "warning",
        title: options.automatic ? "オフライン" : "未接続",
        detail:
          !options.automatic && error instanceof Error
            ? error.message
            : "このチャットを開いている間は自動で接続を試します。相手がKunoChatで同じチャットを開くとオンラインになります。"
      });
    }
  }

  function autoAcceptConnectionRequest(request: ConnectionRequestPayload) {
    const sessionPeerId = sessionPeerIdRef.current;
    const currentSettings = useChatStore.getState().settings;
    if (!sessionPeerId || request.requesterPeerId === currentSettings.localPeerId) {
      return;
    }

    // Glare guard: if we are already dialing/connected to the SAME deterministic
    // room, this request is the peer's half of a simultaneous auto-dial. Ignore
    // it so we do not tear down the connection we are already establishing.
    const status = useChatStore.getState().connectionStatus;
    const normalizedRequestRoom = request.roomId.replace(/\D/g, "").slice(0, 6);
    const currentRoom = lastAutoConnectRef.current?.roomId?.replace(/\D/g, "").slice(0, 6);
    if (
      (status === "connecting" || status === "reconnecting" || status === "connected") &&
      currentRoom &&
      currentRoom === normalizedRequestRoom
    ) {
      setConnectionRequest(undefined);
      return;
    }

    const source = isTailscaleAddress(request.peerHint) ? "tailscale" : "lan";
    // Complement the requester's role; absent/legacy request → we host.
    const mode: "host" | "join" =
      request.requesterRole === "host" ? "join" : request.requesterRole === "join" ? "host" : "host";
    const signalingUrl = mode === "host" ? runtimeConfig.signalingUrl : signalingUrlForPeer(request.peerHint) ?? runtimeConfig.signalingUrl;

    if (status === "connected") {
      realtimeClient.disconnect();
    }

    const conversationId = activateConversation({
      peerId: request.requesterPeerId,
      displayName: request.requesterName || "Peer",
      peerHint: request.peerHint,
      source
    });
    // Remember the requester's stable id so our next reconnect derives the same
    // deterministic room even before identity-hello completes.
    setConversationStablePeerId(conversationId, request.requesterPeerId);
    setConnectionRequest(undefined);
    applyLastAutoConnect({
      signalingUrl,
      roomId: request.roomId,
      mode,
      peerHint: request.peerHint,
      source,
      deviceName: request.requesterName
    });
    setDiagnostic({
      tone: "info",
      title: "接続しました",
      detail: `${request.requesterName || "相手"} と接続しています。`
    });
    void connectRealtime(conversationId, {
      roomId: request.roomId,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode,
      signalingUrl,
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
  const pendingByConversation = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const record of deliveryOutbox) {
      if (record.status === "local_queued" || record.status === "failed_retryable") {
        counts[record.conversationId] = (counts[record.conversationId] ?? 0) + 1;
      }
    }
    return counts;
  }, [deliveryOutbox]);
  const pendingOutboxCount = Object.values(pendingByConversation).reduce((total, count) => total + count, 0);
  const lastAutoConnectMatchesActive =
    Boolean(lastAutoConnect && activeConversation?.peerHint && lastAutoConnect.peerHint === activeConversation.peerHint);
  const hasKnownAutoRecipient = Boolean(activeConversation?.peerHint || activeConversation?.trustedPeer || lastAutoConnectMatchesActive);
  const passiveAutoDiagnostic =
    !diagnostic || diagnostic.title === "自動接続待機中" || diagnostic.title === "オフライン" || diagnostic.title === "未接続";
  // Honest presence: the peer's device answers discovery but its KunoChat
  // port does not. Say so explicitly instead of implying it may come online.
  const activeDetectedPeer = detectedPeers.find((peer) => peer.peerHint && peer.peerHint === activeConversation?.peerHint);
  const activePeerAppDown = Boolean(
    connectionStatus !== "connected" &&
      connectionStatus !== "connecting" &&
      connectionStatus !== "reconnecting" &&
      activeDetectedPeer &&
      activeDetectedPeer.reachable === false
  );
  const activePeerAppDownDiagnostic: ConnectionDiagnostic | undefined =
    activePeerAppDown && activeDetectedPeer
      ? {
          tone: "warning",
          title: "相手のKunoChatが応答していません",
          detail: peerReachabilitySummary(activeDetectedPeer).guidance ?? "",
          sticky: true
        }
      : undefined;
  const showConnectionBanner =
    connectionStatus !== "connected" && (activePeerAppDown || !hasKnownAutoRecipient || !passiveAutoDiagnostic);

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

    ensureActiveConversationConnection("send", true);
  }

  async function handleRetryMessage(messageId: string) {
    await retryMessage(messageId, async (message) => {
      await sendRealtimeMessage(message);
    });
  }

  async function flushPendingConnectionMessages() {
    // Guard against a status flip mid-flush; only flush when the transport is
    // actually ready to carry messages to the bound peer.
    if (!realtimeClient.isReady()) {
      return;
    }
    const state = useChatStore.getState();
    // Flush only the conversation this connection belongs to, NOT the active tab
    // and NOT all conversations (either could misdeliver to the wrong peer).
    const boundConversationId = boundConversationIdRef.current ?? state.activeConversationId;
    const pendingMessages = selectPendingConnectionMessages(state.messages, boundConversationId);

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

    // Re-deliver our own text messages that were "sent" but never acked (e.g. the
    // ack was lost across a reconnect). The receiver dedupes by message id, so
    // this is idempotent and keeps the status at "sent" until an ack arrives.
    const unackedText = selectUnackedTextMessages(useChatStore.getState().messages, boundConversationId);
    for (const message of unackedText) {
      if (pendingDeliveryIdsRef.current.has(message.id)) {
        continue;
      }
      pendingDeliveryIdsRef.current.add(message.id);
      try {
        await sendRealtimeMessage(message);
      } catch {
        // Best-effort re-delivery; a genuine failure will surface via onError.
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
      pendingCount={pendingOutboxCount}
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
          currentPeerName={activeConversation?.displayName}
          currentTrustedPeer={activeConversation?.trustedPeer}
          onChange={handleSettingsChange}
          onClose={() => setView("main")}
          onPickSaveFolder={handlePickSaveFolder}
          onClearHistory={clearHistory}
          onForgetPeer={handleForgetPeer}
          onOpenDiagnostics={() => setView("diagnostics")}
        />
      ) : null}

      {currentView === "diagnostics" ? (
        <DiagnosticsPanel
          connectionContext={{
            lastCandidate: lastAutoConnect
              ? {
                  deviceName: lastAutoConnect.deviceName,
                  peerHint: lastAutoConnect.peerHint,
                  source: lastAutoConnect.source,
                  signalingUrl: lastAutoConnect.signalingUrl,
                  reachable: lastAutoConnect.reachable
                }
              : undefined,
            lastFailure: lastConnectionFailure
          }}
          defaultProbeHost={activeConversation?.peerHint ?? lastAutoConnect?.peerHint}
          onClose={() => setView("main")}
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
            pendingByConversation={pendingByConversation}
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
          {showConnectionBanner ? (
            <ConnectionBanner
              diagnostic={activePeerAppDownDiagnostic ?? diagnostic}
              status={connectionStatus}
              canRetry={Boolean(lastAutoConnect)}
              autoMode={Boolean(activeConversation?.peerHint || lastAutoConnect)}
              peerName={peerName}
              onPair={() => setView("pairing")}
              onRetry={handleRetryAutoConnect}
              onDiagnostics={() => setView("diagnostics")}
            />
          ) : null}
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
            connectionStatus={connectionStatus}
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

// True when the given transfer within a message has already been saved to disk,
// so a re-announced asset-start (bundle retry) must not trigger a re-download.
function alreadySavedTransfer(messageId: string, transferId: string): boolean {
  const message = useChatStore.getState().messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    return false;
  }
  if (message.asset?.transferId === transferId) {
    return Boolean(message.asset.savePath);
  }
  const item = message.bundle?.items.find((candidate) => candidate.transferId === transferId);
  return Boolean(item?.savePath);
}

async function sendRealtimeMessage(message: ChatMessage) {
  if ((message.kind === "text" || message.kind === "link" || message.kind === "code") && message.text) {
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

  return platformAdapter.createNativeBinarySource(asset.localPath, asset.size, asset.isFolder);
}

async function persistReceivedAsset(
  input: { id: string; transferId: string; objectUrl: string; blob: Blob; meta: RealtimeAssetMeta },
  completeTransfer: (payload: { messageId: string; transferId: string; objectUrl?: string; savePath?: string; sha256?: string }) => void,
  failTransfer: (payload: { messageId: string; transferId: string; message: string }) => void
) {
  try {
    if (webrtcSizeLimitExceeded(input.blob.size, Boolean(input.meta.nativeKey))) {
      throw new Error("このサイズはネイティブ転送が必要です。両端末のKunoChatを最新にして再試行してください。");
    }
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
  payload: { requestId: string; roomId: string; requesterName: string; requesterPeerId: string; requesterRole?: "host" | "join" }
): Promise<{ proto: number }> {
  return new Promise<{ proto: number }>((resolve, reject) => {
    const socket = new WebSocket(signalingUrl);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error(`Cannot reach KunoChat at ${signalingUrl}.`));
    }, 5000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "connection-request", ...payload }));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; message?: string; proto?: number };
      if (message.type === "connection-request-ack") {
        window.clearTimeout(timer);
        socket.close();
        resolve({ proto: typeof message.proto === "number" ? message.proto : 1 });
      } else if (message.type === "error") {
        window.clearTimeout(timer);
        socket.close();
        reject(new Error(message.message || "Connection request was rejected by the peer."));
      }
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      socket.close();
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
          <button type="button" onClick={onDecline} className="kuno-focus-ring min-h-8 rounded-input bg-white/80 px-3 py-1.5 text-[12px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
            閉じる
          </button>
          <button type="button" onClick={onAccept} className="kuno-focus-ring min-h-8 rounded-input bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover">
            接続
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({
  diagnostic,
  status,
  canRetry,
  autoMode,
  peerName,
  onPair,
  onRetry,
  onDiagnostics
}: {
  diagnostic?: ConnectionDiagnostic;
  status: ConnectionStatus;
  canRetry: boolean;
  autoMode: boolean;
  peerName: string;
  onPair: () => void;
  onRetry: () => void;
  onDiagnostics: () => void;
}) {
  if (!diagnostic && status === "connected") {
    return null;
  }

  const activeDiagnostic = sanitizeConnectionDiagnostic(
    diagnostic ?? reconnectDiagnostic(status, canRetry, autoMode, peerName),
    status,
    autoMode,
    peerName
  );
  const toneClass =
    activeDiagnostic.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200"
      : activeDiagnostic.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100"
        : "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-950/30 dark:text-blue-100";

  return (
    <div className={`mx-3 mt-2 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-card border px-3 py-2 ${toneClass}`} role="status">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">{activeDiagnostic.title}</div>
          <div className="mt-0.5 overflow-hidden text-[11px] leading-4 opacity-90 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {activeDiagnostic.detail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!autoMode && canRetry ? (
            <button type="button" onClick={onRetry} className="kuno-focus-ring min-h-8 whitespace-nowrap rounded-input bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
              前回の相手に再接続
            </button>
          ) : null}
          {activeDiagnostic.tone !== "info" ? (
            <button type="button" onClick={onDiagnostics} className="kuno-focus-ring min-h-8 whitespace-nowrap rounded-input bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
              診断
            </button>
          ) : null}
          <button type="button" onClick={onPair} className="kuno-focus-ring min-h-8 whitespace-nowrap rounded-input bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/15">
            {autoMode ? "接続先変更" : canRetry ? "別の相手を選ぶ" : "接続先を選ぶ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sanitizeConnectionDiagnostic(
  diagnostic: ConnectionDiagnostic,
  status: ConnectionStatus,
  autoMode: boolean,
  peerName: string
): ConnectionDiagnostic {
  if (diagnostic.sticky) {
    return diagnostic;
  }
  const technicalDetail = /Cannot reach|signaling server|ws:\/\/|wss:\/\/|timed out|ECONN|ENOTFOUND|NetworkError/i.test(diagnostic.detail);
  if (autoMode && (technicalDetail || status === "failed" || status === "offline" || status === "pairing")) {
    return {
      tone: "info",
      title: "自動接続待機中",
      detail: `${peerName} が同じチャットを開くとオンラインになります。送信内容は送信待ちに保存されます。`
    };
  }
  if (technicalDetail) {
    return {
      tone: "warning",
      title: "接続できません",
      detail: "相手のKunoChatが起動中か、同じネットワークにいるかを確認してください。送信内容は送信待ちに保存されます。"
    };
  }
  return diagnostic.detail.length > 90
    ? { ...diagnostic, detail: `${diagnostic.detail.slice(0, 87)}...` }
    : diagnostic;
}

function reconnectDiagnostic(status: ConnectionStatus, canRetry: boolean, autoMode: boolean, peerName: string): ConnectionDiagnostic {
  if (autoMode && (status === "offline" || status === "failed" || status === "pairing")) {
    return {
      tone: "info",
      title: "自動接続待機中",
      detail: `${peerName} が同じチャットを開くとオンラインになります。メッセージは送信待ちに保存されます。`
    };
  }
  if (status === "connecting" || status === "reconnecting") {
    return {
      tone: "warning",
      title: autoMode ? "自動接続中" : "接続中",
      detail: autoMode
        ? `${peerName} が同じチャットを開くのを待っています。`
        : canRetry
          ? "前回の接続先へ接続しています。切り替える場合は別の相手を選んでください。"
          : "接続先を探しています。表示されない場合は接続先を選んでください。"
    };
  }
  if (status === "failed" || status === "offline") {
    return {
      tone: "warning",
      title: "接続が切れています",
      detail: canRetry
        ? "同じ相手へ戻す場合は再接続、別のPCへつなぐ場合は別の相手を選んでください。"
        : "接続したい相手を選んでください。オフラインでもメッセージは送信待ちにできます。"
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
