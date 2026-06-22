import { runtimeConfig } from "../config/runtimeConfig";
import { TRANSFER_LIMITS } from "../transfer/transferTypes";
import { platformAdapter } from "../native/platformAdapter";
import type {
  RealtimeCallbacks,
  RealtimeAssetMeta,
  RealtimeBinarySource,
  RealtimeConnectOptions,
  RealtimeControlMessage,
  RealtimePeer,
  RealtimeTextPayload
} from "./realtimeTypes";

type ServerSignal =
  | { type: "peers"; peers: RealtimePeer[] }
  | { type: "peer-joined"; peer: RealtimePeer }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; payload: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; payload: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; payload: RTCIceCandidateInit }
  | { type: "error"; message: string };

type IncomingTransfer = {
  meta: RealtimeAssetMeta;
  chunks?: BlobPart[];
  receivedBytes: number;
  senderComplete: boolean;
  writeQueue?: Promise<void>;
  failed?: boolean;
};

type SendAssetOptions = {
  sha256?: string | Promise<string | undefined> | undefined;
};

export const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_TRANSFER_ID_LENGTH = 128;

function isValidTransferId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isValidAssetMeta(asset: RealtimeAssetMeta): boolean {
  return (
    isValidTransferId(asset.transferId) &&
    typeof asset.size === "number" &&
    Number.isSafeInteger(asset.size) &&
    asset.size >= 0 &&
    asset.size <= MAX_ASSET_SIZE_BYTES &&
    typeof asset.name === "string" &&
    asset.name.length > 0 &&
    asset.name.length <= 255 &&
    (asset.nativeKey === undefined || /^[a-f0-9]{64}$/i.test(asset.nativeKey))
  );
}

function createNativeTransferKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function closeRealtimeBinarySource(source: File | RealtimeBinarySource) {
  if (!(source instanceof File)) {
    void source.close?.().catch(() => undefined);
  }
}

class TransferCancelledError extends Error {
  constructor() {
    super("Transfer cancelled.");
    this.name = "TransferCancelledError";
  }
}

type OutgoingTransfer = {
  id: string;
  messageId: string;
  cancelled: boolean;
  cancelNotified: boolean;
};

class KunoRealtimeClient {
  private callbacks?: RealtimeCallbacks;
  private options?: RealtimeConnectOptions;
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private control?: RTCDataChannel;
  private binary?: RTCDataChannel;
  private hasStartedOffer = false;
  private lastTypingSent = 0;
  private reconnectTimer?: number;
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private incomingTransfers = new Map<string, IncomingTransfer>();
  private outgoingTransfers = new Map<string, OutgoingTransfer>();
  private pausedTransfers = new Map<string, { resolve: () => void }>();
  private pendingAssets = new Map<
    string,
    { meta: RealtimeAssetMeta; source: File | RealtimeBinarySource; options: SendAssetOptions }
  >();

  configure(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(options: RealtimeConnectOptions) {
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    await this.startConnection(options);
  }

  private async startConnection(options: RealtimeConnectOptions) {
    this.clearReconnectTimer();
    this.closeTransport();
    this.options = {
      ...options,
      roomId: options.roomId.replace(/\D/g, "").slice(0, 6)
    };
    this.hasStartedOffer = false;
    this.callbacks?.onStatus("connecting");

    await this.openSocket();
  }

  disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.closeTransport();
    this.incomingTransfers.clear();
    this.outgoingTransfers.clear();
    for (const transferId of this.pendingAssets.keys()) {
      this.releasePendingAsset(transferId);
    }
    for (const paused of this.pausedTransfers.values()) {
      paused.resolve();
    }
    this.pausedTransfers.clear();
  }

  private closeTransport() {
    if (this.control) {
      this.control.onclose = null;
      this.control.onerror = null;
      this.control.onmessage = null;
    }
    if (this.binary) {
      this.binary.onclose = null;
      this.binary.onerror = null;
      this.binary.onmessage = null;
      this.binary.onbufferedamountlow = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
    }
    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.onicecandidate = null;
      this.peer.ondatachannel = null;
    }
    this.control?.close();
    this.binary?.close();
    this.peer?.close();
    this.socket?.close();
    this.control = undefined;
    this.binary = undefined;
    this.peer = undefined;
    this.socket = undefined;
    this.hasStartedOffer = false;
  }

  isReady() {
    return this.control?.readyState === "open";
  }

  sendText(payload: RealtimeTextPayload) {
    this.sendControl({
      v: 1,
      type: "text",
      ...payload
    });
  }

  sendTyping(isTyping: boolean) {
    const now = Date.now();
    if (isTyping && now - this.lastTypingSent < 450) {
      return;
    }
    this.lastTypingSent = now;
    this.sendControl({
      v: 1,
      type: "typing",
      senderId: this.options?.localPeerId ?? "me",
      senderName: this.options?.displayName ?? "You",
      isTyping,
      at: now
    });
  }

  async sendAsset(meta: RealtimeAssetMeta, source: File | RealtimeBinarySource, options: SendAssetOptions = {}) {
    if (this.binary?.readyState !== "open") {
      closeRealtimeBinarySource(source);
      throw new Error("Binary channel is not open.");
    }
    if (!isValidAssetMeta(meta) || source.size !== meta.size) {
      throw new Error("Invalid asset metadata.");
    }

    const asset = this.canUseNativeTransfer(source)
      ? { ...meta, nativeKey: createNativeTransferKey() }
      : meta;
    this.pendingAssets.set(asset.transferId, { meta: asset, source, options });
    this.sendControl({ v: 1, type: "asset-start", asset });
  }

  requestTransfer(messageId: string, transferId: string, byteOffset?: number) {
    if (!isValidTransferId(transferId) || (byteOffset !== undefined && (!Number.isSafeInteger(byteOffset) || byteOffset < 0))) {
      this.callbacks?.onError("Invalid transfer request.");
      return;
    }
    const incoming = this.incomingTransfers.get(transferId);
    if (incoming?.meta.nativeKey && (byteOffset ?? 0) === 0) {
      void this.requestNativeTransfer(messageId, incoming);
      return;
    }
    try {
      this.sendControl({ v: 1, type: "request-transfer", messageId, transferId, byteOffset });
    } catch (err) {
      console.error("Failed to send request-transfer control message:", err);
    }
  }

  private async requestNativeTransfer(messageId: string, transfer: IncomingTransfer) {
    try {
      const existingSize = await platformAdapter.prepareNativeReceive({
        transferId: transfer.meta.transferId,
        messageId,
        expectedSize: transfer.meta.size,
        key: transfer.meta.nativeKey!
      });
      if (existingSize > 0) {
        this.sendControl({
          v: 1,
          type: "request-transfer",
          messageId,
          transferId: transfer.meta.transferId,
          byteOffset: existingSize
        });
        return;
      }
      this.sendControl({
        v: 1,
        type: "request-native-transfer",
        messageId,
        transferId: transfer.meta.transferId
      });
    } catch (error) {
      console.warn("Native transfer preparation failed; using WebRTC binary fallback.", error);
      this.sendControl({
        v: 1,
        type: "request-transfer",
        messageId,
        transferId: transfer.meta.transferId,
        byteOffset: 0
      });
    }
  }

  private startPendingTransfer(transferId: string, byteOffset?: number) {
    const pending = this.pendingAssets.get(transferId);
    if (!pending) {
      console.warn("[realtimeClient] request-transfer received, but no pending asset found for transferId:", transferId);
      return;
    }
    if (!isValidTransferId(transferId) || !Number.isSafeInteger(byteOffset ?? 0) || (byteOffset ?? 0) < 0 || (byteOffset ?? 0) > pending.source.size) {
      this.notifyTransferFailed(pending.meta, "Invalid transfer resume offset.");
      return;
    }
    if (this.outgoingTransfers.has(transferId)) {
      return;
    }
    void this.executeTransfer(pending.meta, pending.source, pending.options, byteOffset).catch((err) => {
      console.error("Transfer execution failed:", err);
    });
  }

  private startNativePendingTransfer(transferId: string) {
    const pending = this.pendingAssets.get(transferId);
    if (!pending) {
      return;
    }
    if (!this.canUseNativeTransfer(pending.source) || !pending.meta.nativeKey || this.outgoingTransfers.has(transferId)) {
      this.startPendingTransfer(transferId, 0);
      return;
    }
    void this.executeNativeTransfer(pending.meta, pending.source, pending.options).catch((error) => {
      console.error("Native transfer execution failed:", error);
    });
  }

  private canUseNativeTransfer(source: File | RealtimeBinarySource): source is RealtimeBinarySource & { nativePath: string } {
    return !(source instanceof File) && Boolean(source.nativePath && this.options?.nativeEndpoint);
  }

  private async executeTransfer(
    meta: RealtimeAssetMeta,
    source: File | RealtimeBinarySource,
    options: SendAssetOptions,
    byteOffset: number = 0
  ) {
    const outgoingTransfer: OutgoingTransfer = {
      id: meta.transferId,
      messageId: meta.messageId,
      cancelled: false,
      cancelNotified: false
    };
    this.outgoingTransfers.set(meta.transferId, outgoingTransfer);

    const sha256Promise = Promise.resolve(options.sha256).catch(() => undefined);
    
    // Notify local callback that transfer officially started
    const initialProgress = source.size === 0 ? 100 : Math.min(100, Math.round((byteOffset / source.size) * 100));
    this.callbacks?.onLocalAssetProgress({
      id: meta.messageId,
      transferId: meta.transferId,
      progress: initialProgress,
      receivedBytes: byteOffset
    });

    const chunkSize = TRANSFER_LIMITS.chunkSize;
    let offset = byteOffset;
    const size = source.size;
    let lastProgress = -1;
    let lastProgressAt = 0;
    let completed = false;

    try {
      if (size === 0) {
        this.callbacks?.onLocalAssetProgress({ id: meta.messageId, transferId: meta.transferId, progress: 100, receivedBytes: 0 });
      }

      while (offset < size) {
        if (typeof window !== "undefined" && (window as any).__TEST_ERRORS) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        this.throwIfCancelled(outgoingTransfer);
        await this.waitIfPaused(outgoingTransfer.id);
        this.throwIfCancelled(outgoingTransfer);
        await this.waitForBinaryBuffer();
        this.throwIfCancelled(outgoingTransfer);
        const bytes =
          source instanceof File
            ? await source.slice(offset, offset + chunkSize).arrayBuffer()
            : await source.readChunk(offset, chunkSize);
        this.throwIfCancelled(outgoingTransfer);
        if (!this.binary) {
          throw new Error("Binary channel was closed during transfer.");
        }
        this.binary.send(encodeBinaryChunk(meta.transferId, bytes));
        offset += bytes.byteLength;
        const progress = size === 0 ? 100 : Math.min(100, Math.round((offset / size) * 100));
        this.callbacks?.onLocalAssetProgress({ id: meta.messageId, transferId: meta.transferId, progress, receivedBytes: offset });
        const now = performance.now();
        if (progress === 100 || progress - lastProgress >= 3 || now - lastProgressAt > 80) {
          lastProgress = progress;
          lastProgressAt = now;
          this.sendControl({
            v: 1,
            type: "asset-progress",
            id: meta.messageId,
            transferId: meta.transferId,
            progress,
            receivedBytes: offset
          });
        }
      }

      const sha256 = await sha256Promise;
      this.throwIfCancelled(outgoingTransfer);
      this.sendControl({
        v: 1,
        type: "asset-complete",
        id: meta.messageId,
        transferId: meta.transferId,
        objectUrl: "",
        sha256
      });
      completed = true;
    } catch (error) {
      if (error instanceof TransferCancelledError) {
        this.notifyTransferCancelledOnce(outgoingTransfer);
        throw error;
      }

      const message = error instanceof Error ? error.message : "Asset transfer failed.";
      this.notifyTransferFailed(meta, message);
      throw error;
    } finally {
      this.outgoingTransfers.delete(meta.transferId);
      if (!completed) {
        this.releasePendingAsset(meta.transferId);
      }
    }
  }

  private async executeNativeTransfer(
    meta: RealtimeAssetMeta,
    source: RealtimeBinarySource & { nativePath: string },
    options: SendAssetOptions
  ) {
    const remoteEndpoint = this.options?.nativeEndpoint;
    if (!meta.nativeKey || !remoteEndpoint) {
      return this.executeTransfer(meta, source, options, 0);
    }

    const outgoingTransfer: OutgoingTransfer = {
      id: meta.transferId,
      messageId: meta.messageId,
      cancelled: false,
      cancelNotified: false
    };
    this.outgoingTransfers.set(meta.transferId, outgoingTransfer);
    const sha256Promise = Promise.resolve(options.sha256).catch(() => undefined);
    let completed = false;

    this.callbacks?.onLocalAssetProgress({
      id: meta.messageId,
      transferId: meta.transferId,
      progress: 0,
      receivedBytes: 0
    });

    try {
      this.throwIfCancelled(outgoingTransfer);
      await platformAdapter.sendNativeFile({
        transferId: meta.transferId,
        messageId: meta.messageId,
        path: source.nativePath,
        remoteEndpoint,
        expectedSize: meta.size,
        key: meta.nativeKey
      });
      this.throwIfCancelled(outgoingTransfer);
      const sha256 = await sha256Promise;
      this.sendControl({
        v: 1,
        type: "asset-complete",
        id: meta.messageId,
        transferId: meta.transferId,
        objectUrl: "",
        sha256
      });
      completed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Native asset transfer failed.";
      if (message.startsWith("native transfer connection")) {
        this.outgoingTransfers.delete(meta.transferId);
        await this.executeTransfer(meta, source, options, 0);
        completed = true;
        return;
      }
      if (error instanceof TransferCancelledError || outgoingTransfer.cancelled || message === "native transfer cancelled") {
        this.notifyTransferCancelledOnce(outgoingTransfer);
      } else {
        this.notifyTransferFailed(meta, message);
      }
      throw error;
    } finally {
      this.outgoingTransfers.delete(meta.transferId);
      if (!completed) {
        this.releasePendingAsset(meta.transferId);
      }
    }
  }

  private releasePendingAsset(transferId: string) {
    const pending = this.pendingAssets.get(transferId);
    if (!pending) {
      return;
    }
    this.pendingAssets.delete(transferId);
    closeRealtimeBinarySource(pending.source);
  }

  private releasePendingAssetsForMessage(messageId: string) {
    for (const [transferId, pending] of this.pendingAssets) {
      if (pending.meta.messageId === messageId) {
        this.releasePendingAsset(transferId);
      }
    }
  }

  private notifyTransferFailed(meta: RealtimeAssetMeta, message: string) {
    this.callbacks?.onAssetFailed({ id: meta.messageId, transferId: meta.transferId, message });
    try {
      this.sendControl({
        v: 1,
        type: "asset-failed",
        id: meta.messageId,
        transferId: meta.transferId,
        message
      });
    } catch {
      // The local error state remains authoritative when the control channel is gone.
    }
  }

  cancelTransfer(messageId: string, transferId: string, message = "Transfer cancelled.") {
    const outgoingTransfer =
      this.outgoingTransfers.get(transferId) ??
      ({
        id: transferId,
        messageId,
        cancelled: false,
        cancelNotified: false
      } satisfies OutgoingTransfer);
    if (outgoingTransfer) {
      outgoingTransfer.cancelled = true;
    }
    // Also resume any paused waiter so the loop can see cancelled
    this.pausedTransfers.get(transferId)?.resolve();
    this.pausedTransfers.delete(transferId);
    void platformAdapter.cancelNativeSend(transferId).catch(() => undefined);
    this.notifyTransferCancelledOnce(outgoingTransfer, message);
    if (!this.outgoingTransfers.has(transferId)) {
      this.releasePendingAsset(transferId);
    }
  }

  pauseTransfer(messageId: string, transferId: string) {
    const existing = this.pausedTransfers.get(transferId);
    if (!existing) {
      this.pausedTransfers.set(transferId, { resolve: () => undefined });
    }
    void platformAdapter.pauseNativeSend(transferId).catch(() => undefined);
    try {
      this.sendControl({ v: 1, type: "asset-pause", id: messageId, transferId });
    } catch {
      // Best effort
    }
  }

  resumeTransfer(messageId: string, transferId: string) {
    const waiter = this.pausedTransfers.get(transferId);
    if (waiter) {
      waiter.resolve();
      this.pausedTransfers.delete(transferId);
    }
    void platformAdapter.resumeNativeSend(transferId).catch(() => undefined);
    try {
      this.sendControl({ v: 1, type: "asset-resume", id: messageId, transferId });
    } catch {
      // Best effort
    }
  }

  private async waitIfPaused(transferId: string): Promise<void> {
    if (!this.pausedTransfers.has(transferId)) return;
    await new Promise<void>((resolve) => {
      this.pausedTransfers.set(transferId, { resolve });
    });
  }

  private throwIfCancelled(transfer: OutgoingTransfer) {
    if (transfer.cancelled) {
      throw new TransferCancelledError();
    }
  }

  private notifyTransferCancelled(messageId: string, transferId: string, message = "Transfer cancelled.") {
    try {
      this.sendControl({
        v: 1,
        type: "asset-cancelled",
        id: messageId,
        transferId,
        message
      });
    } catch {
      // Cancellation must be local-first; the peer may already be unreachable.
    }
  }

  private notifyTransferCancelledOnce(transfer: OutgoingTransfer, message = "Transfer cancelled.") {
    if (transfer.cancelNotified) {
      return;
    }
    transfer.cancelNotified = true;
    this.notifyTransferCancelled(transfer.messageId, transfer.id, message);
  }

  private async openSocket() {
    if (!this.options) {
      throw new Error("Realtime options are missing.");
    }

    const signalingUrl = this.options.signalingUrl ?? runtimeConfig.signalingUrl;
    const socket = new WebSocket(signalingUrl);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Signaling connection timed out.")), 5000);

      socket.onopen = () => {
        window.clearTimeout(timer);
        socket.send(
          JSON.stringify({
            type: "join",
            roomId: this.options?.roomId,
            peerId: this.options?.localPeerId,
            displayName: this.options?.displayName
          })
        );
        resolve();
      };

      socket.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error(`Cannot reach signaling server at ${signalingUrl}.`));
      };
    }).catch((error) => {
      this.callbacks?.onStatus("failed");
      this.callbacks?.onError(error instanceof Error ? error.message : "Signaling connection failed.");
      this.scheduleReconnect();
      throw error;
    });

    socket.onmessage = (event) => {
      try {
        void this.handleSignal(JSON.parse(String(event.data)) as ServerSignal);
      } catch {
        this.callbacks?.onError("Invalid signaling message received.");
      }
    };
    socket.onclose = () => {
      if (!this.manualDisconnect && this.peer?.connectionState === "connected") {
        this.callbacks?.onStatus("reconnecting");
      }
    };
  }

  private async handleSignal(message: ServerSignal) {
    console.log("[realtimeClient] handleSignal received message:", message.type, "current options:", this.options);
    if (!this.options) {
      return;
    }

    if (message.type === "error") {
      this.callbacks?.onStatus("failed");
      this.callbacks?.onError(message.message);
      return;
    }

    if (message.type === "peers") {
      message.peers[0] && this.callbacks?.onPeer(message.peers[0]);
      if (this.options.mode === "host" && message.peers.length > 0) {
        console.log("[realtimeClient] host sees peers already present, starting offer");
        await this.startOffer();
      } else if (this.options.mode === "host") {
        this.callbacks?.onStatus("pairing");
      }
      return;
    }

    if (message.type === "peer-joined") {
      this.callbacks?.onPeer(message.peer);
      if (this.options.mode === "host") {
        console.log("[realtimeClient] host sees peer-joined, starting offer");
        await this.startOffer();
      }
      return;
    }

    if (message.type === "peer-left") {
      this.callbacks?.onStatus("offline");
      return;
    }

    if (message.type === "offer") {
      console.log("[realtimeClient] received offer, setting remote description...");
      try {
        const peer = this.ensurePeer(false);
        await peer.setRemoteDescription(message.payload);
        console.log("[realtimeClient] remote description set, creating answer...");
        const answer = await peer.createAnswer();
        console.log("[realtimeClient] answer created, setting local description...");
        await peer.setLocalDescription(answer);
        console.log("[realtimeClient] local description set, sending answer...");
        this.sendSignal({ type: "answer", payload: answer });
      } catch (err) {
        console.error("[realtimeClient] error processing offer:", err);
      }
      return;
    }

    if (message.type === "answer") {
      console.log("[realtimeClient] received answer, setting remote description...");
      try {
        await this.peer?.setRemoteDescription(message.payload);
        console.log("[realtimeClient] remote description set from answer successfully");
      } catch (err) {
        console.error("[realtimeClient] error setting remote description from answer:", err);
      }
      return;
    }

    if (message.type === "ice") {
      console.log("[realtimeClient] received ice candidate, adding candidate...");
      try {
        await this.peer?.addIceCandidate(message.payload);
        console.log("[realtimeClient] ice candidate added successfully");
      } catch (err) {
        console.error("[realtimeClient] error adding ice candidate:", err);
      }
    }
  }

  private async startOffer() {
    console.log("[realtimeClient] startOffer() called. hasStartedOffer:", this.hasStartedOffer);
    if (this.hasStartedOffer) {
      return;
    }
    this.hasStartedOffer = true;

    try {
      console.log("[realtimeClient] ensuring peer...");
      const peer = this.ensurePeer(true);
      console.log("[realtimeClient] creating offer...");
      const offer = await peer.createOffer();
      console.log("[realtimeClient] setting local description from offer...");
      await peer.setLocalDescription(offer);
      console.log("[realtimeClient] sending offer signal...");
      this.sendSignal({ type: "offer", payload: offer });
    } catch (err) {
      console.error("[realtimeClient] error in startOffer:", err);
    }
  }

  private ensurePeer(isInitiator: boolean) {
    console.log("[realtimeClient] ensurePeer() called. isInitiator:", isInitiator, "existing peer:", !!this.peer);
    if (this.peer) {
      return this.peer;
    }

    console.log("[realtimeClient] creating RTCPeerConnection with ICE servers:", runtimeConfig.iceServers);
    const peer = new RTCPeerConnection({
      iceServers: runtimeConfig.iceServers,
      bundlePolicy: "max-bundle",
      iceCandidatePoolSize: 4
    });
    this.peer = peer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[realtimeClient] onicecandidate gathered candidate:", event.candidate.candidate);
        this.sendSignal({ type: "ice", payload: event.candidate.toJSON() });
      } else {
        console.log("[realtimeClient] onicecandidate gathering completed (null candidate)");
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("[realtimeClient] peer.connectionState changed:", peer.connectionState);
      if (peer.connectionState === "connected") {
        this.reconnectAttempts = 0;
        this.callbacks?.onStatus("connected");
      } else if (peer.connectionState === "failed") {
        this.callbacks?.onStatus("failed");
        this.scheduleReconnect();
      } else if (peer.connectionState === "disconnected") {
        this.callbacks?.onStatus("reconnecting");
        this.scheduleReconnect();
      } else if (peer.connectionState === "closed") {
        this.callbacks?.onStatus("offline");
      }
    };

    if (isInitiator) {
      console.log("[realtimeClient] initiator: creating control & binary data channels");
      this.attachControlChannel(peer.createDataChannel("control", { ordered: false }));
      this.attachBinaryChannel(peer.createDataChannel("binary", { ordered: true }));
    } else {
      console.log("[realtimeClient] receiver: binding ondatachannel callback");
      peer.ondatachannel = (event) => {
        console.log("[realtimeClient] received data channel from initiator:", event.channel.label);
        if (event.channel.label === "control") {
          this.attachControlChannel(event.channel);
        } else if (event.channel.label === "binary") {
          this.attachBinaryChannel(event.channel);
        }
      };
    }

    return peer;
  }

  private attachControlChannel(channel: RTCDataChannel) {
    this.control = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 16 * 1024;

    channel.onopen = () => {
      this.reconnectAttempts = 0;
      this.callbacks?.onStatus("connected");
      this.sendControl({ v: 1, type: "ping", at: Date.now() });
      this.reannouncePendingAssets();
    };
    channel.onclose = () => {
      if (!this.manualDisconnect) {
        this.callbacks?.onStatus("reconnecting");
        this.scheduleReconnect();
      }
    };
    channel.onerror = () => {
      this.callbacks?.onStatus("failed");
      this.scheduleReconnect();
    };
    channel.onmessage = (event) => {
      try {
        this.handleControl(JSON.parse(String(event.data)) as RealtimeControlMessage);
      } catch {
        this.callbacks?.onError("Invalid realtime control message received.");
      }
    };
  }

  private attachBinaryChannel(channel: RTCDataChannel) {
    this.binary = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = TRANSFER_LIMITS.bufferedAmountLowThreshold;
    channel.onclose = () => {
      if (!this.manualDisconnect && this.peer?.connectionState === "connected") {
        this.callbacks?.onStatus("reconnecting");
        this.scheduleReconnect();
      }
    };
    channel.onerror = () => {
      this.callbacks?.onStatus("failed");
      this.scheduleReconnect();
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          this.handleBinaryChunk(event.data);
        } catch {
          this.callbacks?.onError("Invalid binary transfer frame received.");
        }
      }
    };
  }

  private handleControl(message: RealtimeControlMessage) {
    if (message.type === "text") {
      this.callbacks?.onText(message);
      this.sendControl({ v: 1, type: "ack", id: message.id, receivedAt: Date.now() });
      return;
    }

    if (message.type === "ack") {
      this.releasePendingAssetsForMessage(message.id);
      this.callbacks?.onAck(message.id);
      return;
    }

    if (message.type === "asset-start") {
      if (!isValidAssetMeta(message.asset)) {
        this.callbacks?.onError("Rejected invalid transfer metadata.");
        return;
      }
      void this.registerIncomingTransfer(message.asset);
      return;
    }

    if (message.type === "request-transfer") {
      if (!isValidTransferId(message.transferId)) {
        this.callbacks?.onError("Rejected invalid transfer request.");
        return;
      }
      this.startPendingTransfer(message.transferId, message.byteOffset);
      return;
    }

    if (message.type === "request-native-transfer") {
      if (!isValidTransferId(message.transferId)) {
        this.callbacks?.onError("Rejected invalid native transfer request.");
        return;
      }
      this.startNativePendingTransfer(message.transferId);
      return;
    }

    if (message.type === "asset-progress") {
      if (!isValidTransferId(message.transferId) || !Number.isFinite(message.progress) || !Number.isSafeInteger(message.receivedBytes)) {
        this.callbacks?.onError("Rejected invalid transfer progress.");
        return;
      }
      this.callbacks?.onAssetProgress({
        id: message.id,
        transferId: message.transferId,
        progress: message.progress,
        receivedBytes: message.receivedBytes
      });
      return;
    }

    if (message.type === "asset-complete") {
      const transfer = this.incomingTransfers.get(message.transferId);
      if (transfer) {
        transfer.senderComplete = true;
        transfer.meta.sha256 = message.sha256;
        void this.completeIncomingTransferIfReady(message.transferId);
      }
      return;
    }

    if (message.type === "asset-failed") {
      if (!isValidTransferId(message.transferId)) {
        this.callbacks?.onError("Rejected invalid transfer failure.");
        return;
      }
      this.releasePendingAsset(message.transferId);
      this.callbacks?.onAssetFailed({
        id: message.id,
        transferId: message.transferId,
        message: message.message
      });
      return;
    }

    if (message.type === "asset-cancelled") {
      if (!isValidTransferId(message.transferId)) {
        this.callbacks?.onError("Rejected invalid transfer cancellation.");
        return;
      }
      this.releasePendingAsset(message.transferId);
      this.incomingTransfers.delete(message.transferId);
      const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      if (hasTauri) {
        void platformAdapter.deletePartFile(message.transferId).catch(() => undefined);
        void platformAdapter.cancelNativeReceive(message.transferId).catch(() => undefined);
      }
      this.callbacks?.onAssetCancelled({
        id: message.id,
        transferId: message.transferId,
        message: message.message
      });
      return;
    }

    if (message.type === "typing") {
      this.callbacks?.onTyping({
        peerId: message.senderId,
        senderName: message.senderName,
        isTyping: message.isTyping
      });
      return;
    }

    if (message.type === "asset-pause") {
      const existing = this.pausedTransfers.get(message.transferId);
      if (!existing) {
        this.pausedTransfers.set(message.transferId, { resolve: () => undefined });
      }
      void platformAdapter.pauseNativeSend(message.transferId).catch(() => undefined);
      this.callbacks?.onAssetPaused({ id: message.id, transferId: message.transferId });
      return;
    }

    if (message.type === "asset-resume") {
      const waiter = this.pausedTransfers.get(message.transferId);
      if (waiter) {
        waiter.resolve();
        this.pausedTransfers.delete(message.transferId);
      }
      void platformAdapter.resumeNativeSend(message.transferId).catch(() => undefined);
      this.callbacks?.onAssetResumed({ id: message.id, transferId: message.transferId });
      return;
    }

    if (message.type === "ping") {
      this.sendControl({ v: 1, type: "pong", at: Date.now() });
    }
  }

  private sendControl(message: RealtimeControlMessage) {
    if (this.control?.readyState !== "open") {
      throw new Error("Instant channel is not open.");
    }
    this.control.send(JSON.stringify(message));
  }

  private reannouncePendingAssets() {
    for (const { meta } of this.pendingAssets.values()) {
      try {
        this.sendControl({ v: 1, type: "asset-start", asset: meta });
      } catch {
        return;
      }
    }
  }

  private async registerIncomingTransfer(asset: RealtimeAssetMeta) {
    const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    let receivedBytes = 0;
    if (hasTauri) {
      receivedBytes = asset.nativeKey
        ? await platformAdapter.inspectPartFileSize(asset.transferId).catch(() => 0)
        : await platformAdapter.getPartFileSize(asset.transferId, asset.size).catch(() => 0);
      if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0 || receivedBytes > asset.size) {
        await platformAdapter.deletePartFile(asset.transferId).catch(() => undefined);
        receivedBytes = 0;
      }
    }
    this.incomingTransfers.set(asset.transferId, {
      meta: asset,
      chunks: hasTauri ? undefined : [],
      receivedBytes,
      senderComplete: false
    });
    this.callbacks?.onAssetStart(asset);
  }

  private async waitForBinaryBuffer() {
    if (!this.binary) {
      throw new Error("Binary channel is not open.");
    }

    if (this.binary.bufferedAmount < TRANSFER_LIMITS.maxBufferedAmount) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const channel = this.binary;
      if (!channel) {
        resolve();
        return;
      }
      const originalHandler = channel.onbufferedamountlow;
      const originalError = channel.onerror;
      const originalClose = channel.onclose;
      const restoreHandlers = () => {
        channel.onbufferedamountlow = originalHandler ?? null;
        channel.onerror = originalError ?? null;
        channel.onclose = originalClose ?? null;
      };
      channel.onbufferedamountlow = (event) => {
        originalHandler?.call(channel, event);
        restoreHandlers();
        resolve();
      };
      channel.onerror = (event) => {
        restoreHandlers();
        originalError?.call(channel, event);
        reject(new Error("Binary channel failed while waiting for buffer pressure to clear."));
      };
      channel.onclose = (event) => {
        restoreHandlers();
        originalClose?.call(channel, event);
        reject(new Error("Binary channel closed while waiting for buffer pressure to clear."));
      };
    });
  }

  private handleBinaryChunk(data: ArrayBuffer) {
    const chunk = decodeBinaryChunk(data);
    const transfer = this.incomingTransfers.get(chunk.transferId);
    if (!transfer || transfer.failed) {
      return;
    }

    const nextReceivedBytes = transfer.receivedBytes + chunk.payload.byteLength;
    if (!Number.isSafeInteger(nextReceivedBytes) || nextReceivedBytes > transfer.meta.size) {
      this.failIncomingTransfer(transfer, "Received data exceeds the declared transfer size.");
      return;
    }

    const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    if (hasTauri) {
      const previousWrite = transfer.writeQueue ?? Promise.resolve();
      transfer.writeQueue = previousWrite
        .then(async () => {
          if (transfer.failed) {
            return;
          }
          const newSize = await platformAdapter.writePartChunk(chunk.transferId, chunk.payload, transfer.meta.size);
          if (!Number.isSafeInteger(newSize) || newSize < transfer.receivedBytes || newSize > transfer.meta.size) {
            throw new Error("Part file size is invalid.");
          }
          transfer.receivedBytes = newSize;
          this.reportIncomingProgress(transfer);
        })
        .catch((error) => {
          this.failIncomingTransfer(transfer, error instanceof Error ? error.message : "Failed to save received data.");
        });
    } else {
      if (!transfer.chunks) {
        transfer.chunks = [];
      }
      transfer.chunks.push(chunk.payload);
      transfer.receivedBytes = nextReceivedBytes;
      this.reportIncomingProgress(transfer);
    }

    if (hasTauri) {
      transfer.writeQueue?.then(() => {
        void this.completeIncomingTransferIfReady(chunk.transferId);
      });
    } else {
      void this.completeIncomingTransferIfReady(chunk.transferId);
    }
  }

  private reportIncomingProgress(transfer: IncomingTransfer) {
    const progress = transfer.meta.size === 0 ? 100 : Math.min(100, Math.round((transfer.receivedBytes / transfer.meta.size) * 100));
    this.callbacks?.onAssetProgress({
      id: transfer.meta.messageId,
      transferId: transfer.meta.transferId,
      progress,
      receivedBytes: transfer.receivedBytes
    });
  }

  reportNativeIncomingTransfer(input: {
    transferId: string;
    transferredBytes: number;
    phase: "progress" | "complete" | "failed";
    message?: string;
  }) {
    const transfer = this.incomingTransfers.get(input.transferId);
    if (!transfer) {
      return;
    }
    if (input.phase === "failed") {
      this.failIncomingTransfer(transfer, input.message ?? "Native transfer failed.");
      return;
    }
    if (
      !Number.isSafeInteger(input.transferredBytes) ||
      input.transferredBytes < transfer.receivedBytes ||
      input.transferredBytes > transfer.meta.size
    ) {
      this.failIncomingTransfer(transfer, "Native transfer progress is invalid.");
      return;
    }
    transfer.receivedBytes = input.transferredBytes;
    this.reportIncomingProgress(transfer);
    if (input.phase === "complete") {
      void this.completeIncomingTransferIfReady(input.transferId);
    }
  }

  private failIncomingTransfer(transfer: IncomingTransfer, message: string) {
    if (transfer.failed) {
      return;
    }
    transfer.failed = true;
    this.incomingTransfers.delete(transfer.meta.transferId);
    void platformAdapter.deletePartFile(transfer.meta.transferId).catch(() => undefined);
    void platformAdapter.cancelNativeReceive(transfer.meta.transferId).catch(() => undefined);
    this.callbacks?.onAssetFailed({
      id: transfer.meta.messageId,
      transferId: transfer.meta.transferId,
      message
    });
    try {
      this.sendControl({
        v: 1,
        type: "asset-failed",
        id: transfer.meta.messageId,
        transferId: transfer.meta.transferId,
        message
      });
    } catch {
      // A disconnected peer cannot be notified, but the local state is already failed.
    }
  }

  private async completeIncomingTransferIfReady(transferId: string) {
    const transfer = this.incomingTransfers.get(transferId);
    if (!transfer) {
      return;
    }
    if (!transfer.senderComplete || transfer.receivedBytes < transfer.meta.size) {
      return;
    }

    this.incomingTransfers.delete(transferId);

    const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    let objectUrl = "";
    let blob: Blob | undefined = undefined;
    let savePath: string | undefined = undefined;

    if (hasTauri) {
      try {
        if (transfer.writeQueue) {
          await transfer.writeQueue;
        }

        savePath = await platformAdapter.finalizePartFile(
          transferId,
          transfer.meta.name,
          transfer.meta.size,
          transfer.meta.sha256
        );

        if (transfer.meta.isFolder) {
          try {
            const folderPath = savePath.replace(/\.zip$/i, "");
            await platformAdapter.unzipFile(savePath, folderPath);
            savePath = folderPath;
          } catch (err) {
            console.error("Failed to unzip folder:", err);
            throw new Error("受信したフォルダの解凍に失敗しました。");
          }
        }

        if (transfer.meta.kind === "image" || transfer.meta.mime.startsWith("image/")) {
          const fileBytes = await platformAdapter.readEntireFile(savePath, transfer.meta.size);
          blob = new Blob([fileBytes], { type: transfer.meta.mime });
          objectUrl = URL.createObjectURL(blob);
        }
      } catch (err) {
        console.error("[realtimeClient] Failed to finalize received asset:", err);
        this.callbacks?.onAssetFailed({
          id: transfer.meta.messageId,
          transferId: transfer.meta.transferId,
          message: err instanceof Error ? err.message : "ファイルの保存に失敗しました。"
        });
        return;
      }
    } else {
      blob = new Blob(transfer.chunks ?? [], { type: transfer.meta.mime });
      objectUrl = URL.createObjectURL(blob);
    }

    this.callbacks?.onAssetComplete({
      id: transfer.meta.messageId,
      transferId: transfer.meta.transferId,
      objectUrl,
      blob,
      meta: transfer.meta,
      savePath
    } as any);

    this.sendControl({
      v: 1,
      type: "ack",
      id: transfer.meta.messageId,
      receivedAt: Date.now()
    });
  }

  private sendSignal(message: { type: "offer" | "answer" | "ice"; payload: unknown }) {
    console.log("[realtimeClient] sendSignal called with type:", message.type, "socket state:", this.socket?.readyState);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn("[realtimeClient] sendSignal failed because socket state is not OPEN. State:", this.socket?.readyState);
    }
  }

  private clearReconnectTimer() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private scheduleReconnect() {
    if (this.manualDisconnect || !this.options || this.reconnectTimer) {
      return;
    }

    const options = this.options;
    const delays = [250, 750, 1500, 3000, 5000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts += 1;
    this.callbacks?.onStatus("reconnecting");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.manualDisconnect || this.isReady()) {
        return;
      }
      void this.startConnection(options).catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }
}

export const realtimeClient = new KunoRealtimeClient();

export function encodeBinaryChunk(transferId: string, payload: ArrayBuffer): ArrayBuffer {
  const idBytes = new TextEncoder().encode(transferId);
  if (idBytes.byteLength === 0 || idBytes.byteLength > 0xffff) {
    throw new Error("Invalid transfer id length.");
  }
  const output = new Uint8Array(2 + idBytes.byteLength + payload.byteLength);
  const view = new DataView(output.buffer);
  view.setUint16(0, idBytes.byteLength);
  output.set(idBytes, 2);
  output.set(new Uint8Array(payload), 2 + idBytes.byteLength);
  return output.buffer;
}

export function decodeBinaryChunk(data: ArrayBuffer): { transferId: string; payload: ArrayBuffer } {
  if (data.byteLength < 2) {
    throw new Error("Binary transfer frame is too short.");
  }
  const view = new DataView(data);
  const idLength = view.getUint16(0);
  const idStart = 2;
  const payloadStart = idStart + idLength;
  if (idLength === 0 || payloadStart > data.byteLength) {
    throw new Error("Binary transfer frame has an invalid id length.");
  }
  const transferId = new TextDecoder().decode(data.slice(idStart, payloadStart));
  return {
    transferId,
    payload: data.slice(payloadStart)
  };
}
