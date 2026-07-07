import { describe, expect, test } from "vitest";
import {
  decodeBinaryChunk,
  encodeBinaryChunk,
  identityHelloChanged,
  identityTrustStatus,
  parseStablePeerId,
  webrtcSizeLimitExceeded,
  WEBRTC_RECEIVE_SIZE_LIMIT
} from "./realtimeClient";

describe("webrtcSizeLimitExceeded", () => {
  test("rejects oversized WebRTC-only transfers", () => {
    expect(webrtcSizeLimitExceeded(WEBRTC_RECEIVE_SIZE_LIMIT + 1, false)).toBe(true);
    expect(webrtcSizeLimitExceeded(WEBRTC_RECEIVE_SIZE_LIMIT, false)).toBe(false);
  });

  test("allows large transfers that use the native path", () => {
    expect(webrtcSizeLimitExceeded(5 * 1024 * 1024 * 1024, true)).toBe(false);
  });
});

describe("parseStablePeerId", () => {
  test("accepts valid ids and rejects malformed values", () => {
    expect(parseStablePeerId("peer_ok-1")).toBe("peer_ok-1");
    expect(parseStablePeerId("../x")).toBeUndefined();
    expect(parseStablePeerId(42)).toBeUndefined();
    expect(parseStablePeerId(undefined)).toBeUndefined();
  });
});

function bytes(values: number[]) {
  return new Uint8Array(values).buffer;
}

describe("binary channel chunk framing", () => {
  test.each([
    ["tr_1", [1]],
    ["transfer-long-id", [1, 2, 3, 4]],
    ["jp_id", [255, 0, 128]],
    ["empty-payload", []],
    ["x".repeat(128), [7, 8, 9]]
  ])("round-trips transfer id and payload %#", (transferId, payload) => {
    const decoded = decodeBinaryChunk(encodeBinaryChunk(transferId, bytes(payload)));
    expect(decoded.transferId).toBe(transferId);
    expect(Array.from(new Uint8Array(decoded.payload))).toEqual(payload);
  });

  test("stores id length in the first two bytes", () => {
    const encoded = encodeBinaryChunk("abc", bytes([1]));
    expect(new DataView(encoded).getUint16(0)).toBe(3);
  });

  test("places payload after the id bytes", () => {
    const encoded = new Uint8Array(encodeBinaryChunk("abc", bytes([9, 10])));
    expect(Array.from(encoded.slice(5))).toEqual([9, 10]);
  });

  test("keeps independent frames isolated", () => {
    const left = decodeBinaryChunk(encodeBinaryChunk("left", bytes([1, 2])));
    const right = decodeBinaryChunk(encodeBinaryChunk("right", bytes([3, 4])));
    expect(left.transferId).toBe("left");
    expect(right.transferId).toBe("right");
    expect(Array.from(new Uint8Array(left.payload))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(right.payload))).toEqual([3, 4]);
  });

  test("handles binary-like zero bytes", () => {
    const decoded = decodeBinaryChunk(encodeBinaryChunk("zero", bytes([0, 0, 0])));
    expect(Array.from(new Uint8Array(decoded.payload))).toEqual([0, 0, 0]);
  });

  test("handles maximum single-byte values", () => {
    const decoded = decodeBinaryChunk(encodeBinaryChunk("max", bytes([255, 254, 253])));
    expect(Array.from(new Uint8Array(decoded.payload))).toEqual([255, 254, 253]);
  });

  test("rejects a frame without a header", () => {
    expect(() => decodeBinaryChunk(new ArrayBuffer(1))).toThrow("too short");
  });

  test("rejects a frame whose declared id exceeds its bytes", () => {
    const frame = new Uint8Array([0, 8, 1, 2]).buffer;
    expect(() => decodeBinaryChunk(frame)).toThrow("invalid id length");
  });

  test("rejects a frame with an invalid transfer id", () => {
    expect(() => decodeBinaryChunk(encodeBinaryChunk("日本語id", bytes([1])))).toThrow("invalid transfer id");
  });
});

describe("device identity hello handling", () => {
  test("ignores nonce changes for the same remote identity", () => {
    const existing = {
      senderId: "peer_sender",
      publicKey: "a".repeat(64),
      nonce: "b".repeat(64)
    };

    expect(identityHelloChanged(existing, existing)).toBe("same");
    expect(identityHelloChanged(existing, { ...existing, nonce: "c".repeat(64) })).toBe("same");
  });

  test("distinguishes a changed remote identity from a replayed hello", () => {
    const existing = {
      senderId: "peer_sender",
      publicKey: "a".repeat(64),
      nonce: "b".repeat(64)
    };

    expect(identityHelloChanged(undefined, existing)).toBe("new");
    expect(identityHelloChanged(existing, { ...existing, senderId: "peer_other" })).toBe("identity");
    expect(identityHelloChanged(existing, { ...existing, publicKey: "c".repeat(64) })).toBe("identity");
  });

  test("allows a newly selected peer even when another trusted peer is stored", () => {
    const trustedPeer = {
      publicKey: "a".repeat(64),
      fingerprint: "aa:bb",
      verifiedAt: Date.now()
    };

    expect(identityTrustStatus(trustedPeer, { publicKey: "a".repeat(64), fingerprint: "aa:bb" })).toBe("trusted");
    expect(identityTrustStatus(trustedPeer, { publicKey: "b".repeat(64), fingerprint: "cc:dd" })).toBe("new");
  });
});
