import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { Composer } from "../components/Composer";
import { DropOverlay } from "../components/DropOverlay";
import { Header } from "../components/Header";
import { MessageList } from "../components/MessageList";
import { PairingScreen } from "../components/PairingScreen";
import { SettingsScreen } from "../components/SettingsScreen";
import { WindowShell } from "../components/WindowShell";
import { useChatStore } from "../features/chat/chatStore";
import { runtimeConfig } from "../features/config/runtimeConfig";
import type { ChatMessage, DraftAttachment } from "../features/chat/messageTypes";
import { platformAdapter } from "../features/native/platformAdapter";
import { realtimeClient } from "../features/realtime/realtimeClient";
import type { RealtimeAssetMeta, RealtimeBinarySource } from "../features/realtime/realtimeTypes";
import { parseClipboardItems } from "../features/sendables/clipboardParser";
import { parseDroppedFiles } from "../features/sendables/dropParser";
import { sha256ArrayBuffer, sha256ForAsset } from "../features/transfer/hash";
import { listen } from "@tauri-apps/api/event";

type AutoConnectPayload = {
  signalingUrl: string;
  roomId: string;
  mode: "host" | "join";
  peerHint: string;
  source?: "lan" | "tailscale";
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
    messages,
    draftText,
    attachments,
    isDraggingOver,
    peerTyping,
    settings,
    setView,
    setConnectionStatus,
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
    clearHistory
  } = useChatStore();
  const pairingCode = useMemo(createPairingCode, []);
  const sessionPeerIdRef = useRef<string>();
  const hostedRoomRef = useRef<string>();
  const autoConnectRef = useRef<string>();
  const typingStopTimerRef = useRef<number>();
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic>();
  const [lastAutoConnect, setLastAutoConnect] = useState<AutoConnectPayload>();
  if (!sessionPeerIdRef.current) {
    sessionPeerIdRef.current = `${settings.localPeerId}_${crypto.randomUUID()}`;
  }

  useEffect(() => {
    void platformAdapter.positionTopRight();
  }, []);

  // OS dark mode sync
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (dark: boolean) => document.body.classList.toggle("dark", dark);
    apply(mq.matches);
    const handler = (event: MediaQueryListEvent) => apply(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    realtimeClient.configure({
      onStatus: (status) => {
        setConnectionStatus(status);
        if (status === "connected") {
          setDiagnostic(undefined);
          setView("main");
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
      onText: receivePeerText,
      onAssetStart: (asset) => {
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
          sha256: asset.sha256
        });
      },
      onAssetProgress: ({ id, transferId, progress }) =>
        updateTransferProgress({ messageId: id, transferId, progress }),
      onAssetComplete: ({ id, transferId, objectUrl, blob, meta }) => {
        if (blob && meta) {
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
      onLocalAssetProgress: ({ id, transferId, progress }) =>
        updateTransferProgress({ messageId: id, transferId, progress }),
      onAck: (messageId) => markMessageStatus(messageId, "received"),
      onTyping: ({ senderName, isTyping }) => {
        updateSettings({ peerDisplayName: senderName });
        setPeerTyping(isTyping);
        if (isTyping) {
          window.clearTimeout(typingStopTimerRef.current);
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
      mode: "host"
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
        const sessionPeerId = sessionPeerIdRef.current;
        if (!sessionPeerId) {
          return;
        }

        const state = useChatStore.getState();
        if (state.connectionStatus === "connected") {
          return;
        }

        const key = `${event.payload.signalingUrl}:${event.payload.roomId}:${event.payload.mode}`;
        if (autoConnectRef.current === key && state.connectionStatus === "connecting") {
          return;
        }

        autoConnectRef.current = key;
        setLastAutoConnect(event.payload);
        const sourceLabel = event.payload.source === "tailscale" ? "Tailscale" : "LAN";
        setDiagnostic({
          tone: "info",
          title: `${sourceLabel}でKunoChatを検出`,
          detail: `${event.payload.peerHint} と接続を準備しています。`
        });
        setView("main");
        void realtimeClient.connect({
          roomId: event.payload.roomId,
          localPeerId: sessionPeerId,
          displayName: state.settings.displayName || "You",
          mode: event.payload.mode,
          signalingUrl: event.payload.signalingUrl
        }).catch(() => undefined);
      })
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => callbacks.forEach((unlisten) => unlisten()));
    };
  }, []);

  async function handlePickFiles() {
    if (useChatStore.getState().connectionStatus !== "connected") {
      setView("pairing");
      return;
    }

    const pickedFiles = await platformAdapter.pickFiles();
    addAttachments(
      pickedFiles.map((file) => ({
        id: file.id,
        kind: file.mime.startsWith("image/") ? "image" : "file",
        name: file.name,
        size: file.size,
        mime: file.mime,
        localPath: file.localPath
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

    if (useChatStore.getState().connectionStatus !== "connected") {
      setView("pairing");
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) {
      return;
    }

    addAttachments(parseDroppedFiles(droppedFiles));
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingOver(useChatStore.getState().connectionStatus === "connected");
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDraggingOver(false);
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (useChatStore.getState().connectionStatus !== "connected") {
      return;
    }

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

    void realtimeClient.connect({
      roomId: normalizedCode,
      localPeerId: sessionPeerId,
      displayName: settings.displayName || "You",
      mode: "join"
    }).catch(() => undefined);
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
      signalingUrl: payload.signalingUrl
    }).catch(() => undefined);
  }

  const peerName = settings.peerDisplayName ?? (connectionStatus === "connected" ? "Peer" : "未接続");
  const composerDisabled = connectionStatus !== "connected";

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

  async function handleSendDraft() {
    await sendDraft(async (message) => {
      await sendRealtimeMessage(message);
    });
  }

  async function handleRetryMessage(messageId: string) {
    await retryMessage(messageId, async (message) => {
      await sendRealtimeMessage(message);
    });
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
      unreadCount={0}
      activeTransferCount={messages.filter((message) => message.status === "sending").length}
      onOpenMain={() => setView("main")}
    >
      {currentView === "pairing" ? (
        <PairingScreen
          status={connectionStatus}
          signalingConfigured={runtimeConfig.signalingConfigured}
          pairingCode={pairingCode}
          signalingUrl={runtimeConfig.signalingUrl}
          onBack={() => setView("main")}
          onConnect={handleConnect}
        />
      ) : null}

      {currentView === "settings" ? (
        <SettingsScreen
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setView("main")}
          onPickSaveFolder={handlePickSaveFolder}
          onClearHistory={clearHistory}
        />
      ) : null}

      {currentView === "main" ? (
        <div
          className="relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
        >
          <Header status={connectionStatus} peerName={peerName} onSettings={() => setView("settings")} />
          <ConnectionBanner
            diagnostic={diagnostic}
            status={connectionStatus}
            onPair={() => setView("pairing")}
            onRetry={handleRetryAutoConnect}
          />
          <MessageList
            messages={messages}
            connectionStatus={connectionStatus}
            peerName={peerName}
            showTyping={peerTyping}
            onRetryMessage={(messageId) => void handleRetryMessage(messageId)}
            onCancelMessage={handleCancelMessage}
            onPauseMessage={handlePauseMessage}
            onResumeMessage={handleResumeMessage}
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
    const sha256 = sha256ForAsset(message.asset);
    await realtimeClient.sendAsset(
      {
        id: message.asset.id,
        messageId: message.id,
        transferId: message.asset.transferId,
        senderId: message.senderId,
        senderName: message.senderName,
        createdAt: message.createdAt,
        kind: message.asset.kind,
        name: message.asset.name,
        size: message.asset.size,
        mime: message.asset.mime
      },
      createBinarySource(message.asset),
      { sha256 }
    );
    return;
  }

  if (message.kind === "bundle" && message.bundle) {
    for (const item of message.bundle.items) {
      const sha256 = sha256ForAsset(item);
      await realtimeClient.sendAsset(
        {
          id: item.id,
          messageId: message.id,
          transferId: item.transferId,
          senderId: message.senderId,
          senderName: message.senderName,
          createdAt: message.createdAt,
          kind: item.kind,
          name: item.name,
          size: item.size,
          mime: item.mime,
          caption: message.bundle.caption
        },
        createBinarySource(item),
        { sha256 }
      );
    }
    return;
  }

  throw new Error("This message does not contain a readable payload.");
}

function createBinarySource(asset: NonNullable<ChatMessage["asset"]> | NonNullable<ChatMessage["bundle"]>["items"][number]): File | RealtimeBinarySource {
  if (asset.file) {
    return asset.file;
  }

  if (!asset.localPath) {
    throw new Error(`${asset.name} is not readable from this session.`);
  }

  return {
    size: asset.size,
    readChunk: (offset, length) => platformAdapter.readFileChunk(asset.localPath!, offset, length)
  };
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
      completeTransfer({
        messageId: input.id,
        transferId: input.transferId,
        objectUrl: input.objectUrl,
        savePath,
        sha256: input.meta.sha256
      });
      await platformAdapter.showNotification({
        title: "KunoChat",
        body: `${input.meta.name} を保存しました`
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

function ConnectionBanner({
  diagnostic,
  status,
  onPair,
  onRetry
}: {
  diagnostic?: ConnectionDiagnostic;
  status: string;
  onPair: () => void;
  onRetry: () => void;
}) {
  if (!diagnostic && status === "connected") {
    return null;
  }

  const activeDiagnostic =
    diagnostic ??
    (status === "pairing"
      ? {
          tone: "info" as const,
          title: "接続待ち",
          detail: "同じWi-Fi/LANで相手のKunoChatを開くと自動接続を試みます。"
        }
      : undefined);

  if (!activeDiagnostic) {
    return null;
  }

  const toneClass =
    activeDiagnostic.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : activeDiagnostic.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-blue-100 bg-blue-50 text-blue-700";

  return (
    <div className={`mx-3 mt-3 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-[12px] border px-3 py-2 ${toneClass}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">{activeDiagnostic.title}</div>
          <div className="mt-0.5 break-words text-[11px] leading-4 opacity-90">{activeDiagnostic.detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onRetry} className="rounded-pill bg-white/80 px-2 py-1 text-[11px] font-medium shadow-sm">
            Retry
          </button>
          <button type="button" onClick={onPair} className="rounded-pill bg-white/80 px-2 py-1 text-[11px] font-medium shadow-sm">
            Pair
          </button>
        </div>
      </div>
    </div>
  );
}

function createPairingCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes).reduce((total, byte) => (total * 256 + byte) % 1_000_000, 0);
  return value.toString().padStart(6, "0").replace(/(\d{3})(\d{3})/, "$1-$2");
}
