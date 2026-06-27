import { describe, expect, test } from "vitest";
import { describeDataChannelPlan } from "./dataChannels";
import { TRANSFER_LIMITS } from "../transfer/transferTypes";

describe("RTC data channel policy", () => {
  test("keeps instant control off the ordered binary lane", () => {
    const control = describeDataChannelPlan().find((channel) => channel.name === "control");
    expect(control).toMatchObject({ ordered: false });
  });

  test("keeps binary payloads ordered for file assembly", () => {
    const binary = describeDataChannelPlan().find((channel) => channel.name === "binary");
    expect(binary).toMatchObject({ ordered: true });
  });

  test("uses a larger chunk size for high-throughput file sends", () => {
    expect(TRANSFER_LIMITS.chunkSize).toBe(256 * 1024);
  });

  test("keeps binary backpressure below the high water mark", () => {
    expect(TRANSFER_LIMITS.bufferedAmountLowThreshold).toBeLessThan(TRANSFER_LIMITS.maxBufferedAmount);
  });
});
