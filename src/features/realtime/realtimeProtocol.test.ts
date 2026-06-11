import { describe, expect, test } from "vitest";
import { decodeBinaryChunk, encodeBinaryChunk } from "./realtimeClient";

function bytes(values: number[]) {
  return new Uint8Array(values).buffer;
}

describe("binary channel chunk framing", () => {
  test.each([
    ["tr_1", [1]],
    ["transfer-long-id", [1, 2, 3, 4]],
    ["日本語id", [255, 0, 128]],
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
});
