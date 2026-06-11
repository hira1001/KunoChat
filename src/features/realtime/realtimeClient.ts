import { runtimeConfig } from "../config/runtimeConfig";
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

class KunoRealtimeClient {
  private callbacks?: RealtimeCallbacks;
  private options?: RealtimeConnectOptions;
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private control?: RTCDataChannel;
  private binary?: RTCDataChannel;
  private hasStartedOffer = false;
  private lastTypingSent = 0;
  private incomingTransfers = new Map<string, { meta: RealtimeAssetMeta; chunks: BlobPart[]; receivedBytes: number }>();

  configure(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(options: RealtimeConnectOptions) {
    this.disconnect();
    this.options = {
      ...options,
      roomId: options.roomId.replace(/\D/g, "").slice(0, 6)
    };
    this.hasStartedOffer = false;
    this.callbacks?.onStatus("connecting");

    await this.openSocket();
  }

  disconnect() {
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

  async sendAsset(meta: RealtimeAssetMeta, source: File | RealtimeBinarySource) {
    if (this.binary?.readyState !== "open") {
      throw new Error("Binary channel is not open.");
    }

    this.sendControl({ v: 1, type: "asset-start", asset: meta });

    const chunkSize = 64 * 1024;
    let offset = 0;
    const size = source.size;
    while (offset < size) {
      await this.waitForBinaryBuffer();
      const bytes =
        source instanceof File
          ? await source.slice(offset, offset + chunkSize).arrayBuffer()
          : await source.readChunk(offset, chunkSize);
      this.binary.send(encodeBinaryChunk(meta.transferId, bytes));
      offset += bytes.byteLength;
      const progress = size === 0 ? 100 : Math.min(100, Math.round((offset / size) * 100));
      this.callbacks?.onLocalAssetProgress({ id: meta.messageId, transferId: meta.transferId, progress });
      this.sendControl({
        v: 1,
        type: "asset-progress",
        id: meta.messageId,
        transferId: meta.transferId,
        progress,
        receivedBytes: offset
      });
    }

    this.sendControl({
      v: 1,
      type: "asset-complete",
      id: meta.messageId,
      transferId: meta.transferId,
      objectUrl: ""
    });
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
      throw error;
    });

    socket.onmessage = (event) => {
      void this.handleSignal(JSON.parse(String(event.data)) as ServerSignal);
    };
    socket.onclose = () => {
      if (this.peer?.connectionState === "connected") {
        this.callbacks?.onStatus("reconnecting");
      }
    };
  }

  private async handleSignal(message: ServerSignal) {
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
        await this.startOffer();
      }
      return;
    }

    if (message.type === "peer-joined") {
      this.callbacks?.onPeer(message.peer);
      if (this.options.mode === "host") {
        await this.startOffer();
      }
      return;
    }

    if (message.type === "peer-left") {
      this.callbacks?.onStatus("offline");
      return;
    }

    if (message.type === "offer") {
      const peer = this.ensurePeer(false);
      await peer.setRemoteDescription(message.payload);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.sendSignal({ type: "answer", payload: answer });
      return;
    }

    if (message.type === "answer") {
      await this.peer?.setRemoteDescription(message.payload);
      return;
    }

    if (message.type === "ice") {
      await this.peer?.addIceCandidate(message.payload);
    }
  }

  private async startOffer() {
    if (this.hasStartedOffer) {
      return;
    }
    this.hasStartedOffer = true;

    const peer = this.ensurePeer(true);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.sendSignal({ type: "offer", payload: offer });
  }

  private ensurePeer(isInitiator: boolean) {
    if (this.peer) {
      return this.peer;
    }

    const peer = new RTCPeerConnection({
      iceServers: runtimeConfig.iceServers
    });
    this.peer = peer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ type: "ice", payload: event.candidate.toJSON() });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        this.callbacks?.onStatus("connected");
      } else if (peer.connectionState === "failed") {
        this.callbacks?.onStatus("failed");
      } else if (peer.connectionState === "disconnected") {
        this.callbacks?.onStatus("reconnecting");
      } else if (peer.connectionState === "closed") {
        this.callbacks?.onStatus("offline");
      }
    };

    if (isInitiator) {
      this.attachControlChannel(peer.createDataChannel("control", { ordered: true }));
      this.attachBinaryChannel(peer.createDataChannel("binary", { ordered: true }));
    } else {
      peer.ondatachannel = (event) => {
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
      this.callbacks?.onStatus("connected");
      this.sendControl({ v: 1, type: "ping", at: Date.now() });
    };
    channel.onclose = () => this.callbacks?.onStatus("offline");
    channel.onerror = () => this.callbacks?.onStatus("failed");
    channel.onmessage = (event) => {
      this.handleControl(JSON.parse(String(event.data)) as RealtimeControlMessage);
    };
  }

  private attachBinaryChannel(channel: RTCDataChannel) {
    this.binary = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 512 * 1024;
    channel.onclose = () => {
      if (this.peer?.connectionState === "connected") {
        this.callbacks?.onStatus("reconnecting");
      }
    };
    channel.onerror = () => this.callbacks?.onStatus("failed");
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryChunk(event.data);
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
      this.callbacks?.onAck(message.id);
      return;
    }

    if (message.type === "asset-start") {
      this.incomingTransfers.set(message.asset.transferId, {
        meta: message.asset,
        chunks: [],
        receivedBytes: 0
      });
      this.callbacks?.onAssetStart(message.asset);
      return;
    }

    if (message.type === "asset-progress") {
      this.callbacks?.onAssetProgress({
        id: message.id,
        transferId: message.transferId,
        progress: message.progress
      });
      return;
    }

    if (message.type === "asset-complete") {
      this.callbacks?.onAssetComplete({
        id: message.id,
        transferId: message.transferId,
        objectUrl: message.objectUrl
      });
      return;
    }

    if (message.type === "asset-failed") {
      this.callbacks?.onAssetFailed({
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

  private async waitForBinaryBuffer() {
    if (!this.binary) {
      throw new Error("Binary channel is not open.");
    }

    if (this.binary.bufferedAmount < 2 * 1024 * 1024) {
      return;
    }

    await new Promise<void>((resolve) => {
      const channel = this.binary;
      if (!channel) {
        resolve();
        return;
      }
      const originalHandler = channel.onbufferedamountlow;
      channel.onbufferedamountlow = (event) => {
        originalHandler?.call(channel, event);
        resolve();
      };
    });
  }

  private handleBinaryChunk(data: ArrayBuffer) {
    const chunk = decodeBinaryChunk(data);
    const transfer = this.incomingTransfers.get(chunk.transferId);
    if (!transfer) {
      return;
    }

    transfer.chunks.push(chunk.payload);
    transfer.receivedBytes += chunk.payload.byteLength;

    const progress = Math.min(100, Math.round((transfer.receivedBytes / transfer.meta.size) * 100));
    this.callbacks?.onAssetProgress({
      id: transfer.meta.messageId,
      transferId: transfer.meta.transferId,
      progress
    });

    if (transfer.receivedBytes >= transfer.meta.size) {
      const blob = new Blob(transfer.chunks, { type: transfer.meta.mime });
      const objectUrl = URL.createObjectURL(blob);
      this.incomingTransfers.delete(chunk.transferId);
      this.callbacks?.onAssetComplete({
        id: transfer.meta.messageId,
        transferId: transfer.meta.transferId,
        objectUrl,
        blob,
        meta: transfer.meta
      });
      this.sendControl({
        v: 1,
        type: "ack",
        id: transfer.meta.messageId,
        receivedAt: Date.now()
      });
    }
  }

  private sendSignal(message: { type: "offer" | "answer" | "ice"; payload: unknown }) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

export const realtimeClient = new KunoRealtimeClient();

function encodeBinaryChunk(transferId: string, payload: ArrayBuffer): ArrayBuffer {
  const idBytes = new TextEncoder().encode(transferId);
  const output = new Uint8Array(2 + idBytes.byteLength + payload.byteLength);
  const view = new DataView(output.buffer);
  view.setUint16(0, idBytes.byteLength);
  output.set(idBytes, 2);
  output.set(new Uint8Array(payload), 2 + idBytes.byteLength);
  return output.buffer;
}

function decodeBinaryChunk(data: ArrayBuffer): { transferId: string; payload: ArrayBuffer } {
  const view = new DataView(data);
  const idLength = view.getUint16(0);
  const idStart = 2;
  const payloadStart = idStart + idLength;
  const transferId = new TextDecoder().decode(data.slice(idStart, payloadStart));
  return {
    transferId,
    payload: data.slice(payloadStart)
  };
}
