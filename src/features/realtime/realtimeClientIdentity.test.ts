import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDeviceIdentity must resolve to a fixed valid key so beginIdentityHandshake
// can send an identity-hello without touching Tauri.
vi.mock("../native/platformAdapter", () => ({
  platformAdapter: {
    getDeviceIdentity: vi.fn(async () => ({
      publicKey: "a".repeat(64),
      fingerprint: "local-fingerprint"
    }))
  }
}));

import { realtimeClient } from "./realtimeClient";

type StubChannel = {
  readyState: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function stubChannel(): StubChannel {
  return { readyState: "open", send: vi.fn(), close: vi.fn() };
}

function makeCallbacks() {
  const statuses: string[] = [];
  const errors: string[] = [];
  const identities: unknown[] = [];
  return {
    statuses,
    errors,
    identities,
    callbacks: {
      onStatus: (status: string) => {
        statuses.push(status);
      },
      onPeer: () => undefined,
      onIdentity: (identity: unknown) => {
        identities.push(identity);
      },
      onText: () => undefined,
      onAssetStart: () => undefined,
      onAssetProgress: () => undefined,
      onAssetComplete: () => undefined,
      onAssetFailed: () => undefined,
      onAssetCancelled: () => undefined,
      onAssetPaused: () => undefined,
      onAssetResumed: () => undefined,
      onLocalAssetProgress: () => undefined,
      onAck: () => undefined,
      onTyping: () => undefined,
      onError: (message: string) => errors.push(message)
    }
  };
}

const REMOTE_HELLO = {
  v: 1 as const,
  type: "identity-hello" as const,
  senderId: "peer_remote",
  publicKey: "b".repeat(64),
  nonce: "c".repeat(64),
  stablePeerId: "peer_remote"
};

// Sets up the singleton as if a control channel just opened, without a real
// WebRTC/socket transport.
function primeControlChannel(channel: StubChannel, harness: ReturnType<typeof makeCallbacks>) {
  const client = realtimeClient as any;
  client.callbacks = harness.callbacks;
  client.options = { roomId: "123456", localPeerId: "peer_local", displayName: "Me", mode: "join" };
  client.identity = { verified: false };
  client.control = channel;
  client.localConnected = false;
}

afterEach(() => {
  realtimeClient.disconnect();
  vi.useRealTimers();
});

describe("identity gating (C-3/C-7)", () => {
  beforeEach(() => {
    (realtimeClient as any).callbacks = undefined;
  });

  it("control_open_keeps_status_connecting_until_identity_hello", async () => {
    const harness = makeCallbacks();
    const channel = stubChannel();
    primeControlChannel(channel, harness);

    (realtimeClient as any).acceptOpenControlChannel();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.statuses).not.toContain("connected");
    // An identity-hello must have been sent on the control channel.
    expect(channel.send).toHaveBeenCalled();
    const sent = JSON.parse(channel.send.mock.calls[0][0] as string);
    expect(sent.type).toBe("identity-hello");
    expect(realtimeClient.isReady()).toBe(false);
  });

  it("identity_hello_verification_emits_connected_after_verified", async () => {
    const harness = makeCallbacks();
    const channel = stubChannel();
    primeControlChannel(channel, harness);
    (realtimeClient as any).acceptOpenControlChannel();
    await Promise.resolve();

    let readyWhenConnected: boolean | undefined;
    harness.callbacks.onStatus = (status: string) => {
      harness.statuses.push(status);
      if (status === "connected") {
        readyWhenConnected = realtimeClient.isReady();
      }
    };

    (realtimeClient as any).handleControl(channel, REMOTE_HELLO);
    // fingerprintFromPublicKey is async (crypto.subtle); poll until it resolves
    // rather than relying on a single microtask turn (flaky under full-suite load).
    await vi.waitFor(() => {
      expect(harness.statuses).toContain("connected");
    });

    expect(harness.statuses).toContain("connected");
    expect(readyWhenConnected).toBe(true);
    expect(harness.identities).toHaveLength(1);
    expect((harness.identities[0] as any).stablePeerId).toBe("peer_remote");
  });

  it("text_send_before_verification_throws_identity_error", () => {
    const harness = makeCallbacks();
    const channel = stubChannel();
    primeControlChannel(channel, harness);

    expect(() =>
      realtimeClient.sendText({ id: "m1", senderId: "peer_local", senderName: "Me", createdAt: 0, text: "hi" })
    ).toThrowError("Peer identity has not been verified.");
  });

  it("identity_timeout_emits_failed_and_closes_transport", () => {
    vi.useFakeTimers();
    const harness = makeCallbacks();
    const channel = stubChannel();
    primeControlChannel(channel, harness);

    (realtimeClient as any).startIdentityTimeout();
    vi.advanceTimersByTime(10_000);

    expect(harness.statuses).toContain("failed");
    expect(harness.errors.some((message) => message.includes("本人確認"))).toBe(true);
    expect(channel.close).toHaveBeenCalled();
  });

  it("server_error_closes_socket_without_reconnect", async () => {
    vi.useFakeTimers();
    const harness = makeCallbacks();
    const channel = stubChannel();
    primeControlChannel(channel, harness);
    const socket = { close: vi.fn(), onclose: null, onerror: null, onmessage: null } as any;
    (realtimeClient as any).socket = socket;

    await (realtimeClient as any).handleSignal({ type: "error", message: "room already has two peers" });

    expect(socket.close).toHaveBeenCalled();
    expect(harness.statuses).toContain("failed");
    // No reconnect scheduled against a room that will never accept us.
    expect((realtimeClient as any).reconnectTimer).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect((realtimeClient as any).reconnectTimer).toBeUndefined();
  });
});
