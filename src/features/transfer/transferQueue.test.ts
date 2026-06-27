import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInstantTextQueueItem, sortTransferQueue } from "./transferQueue";
import type { TransferQueueItem } from "./transferTypes";

function item(id: string, priority: TransferQueueItem["priority"], createdAt: number): TransferQueueItem {
  return {
    id,
    itemId: id,
    priority,
    status: "queued",
    progress: 0,
    sentBytes: 0,
    totalBytes: 0,
    createdAt
  };
}

describe("sortTransferQueue", () => {
  test.each([
    [["normal", "instant"], ["instant", "normal"]],
    [["low", "high", "normal"], ["high", "normal", "low"]],
    [["low", "instant", "high", "normal"], ["instant", "high", "normal", "low"]],
    [["instant", "instant"], ["instant", "instant"]],
    [["normal", "normal"], ["normal", "normal"]],
    [["high", "high", "instant"], ["instant", "high", "high"]]
  ] as const)("sorts by priority %#", (priorities, expected) => {
    const sorted = sortTransferQueue(priorities.map((priority, index) => item(`${priority}-${index}`, priority, index)));
    expect(sorted.map((entry) => entry.priority)).toEqual(expected);
  });

  test("preserves createdAt order within the same priority", () => {
    const sorted = sortTransferQueue([item("late", "normal", 20), item("early", "normal", 10)]);
    expect(sorted.map((entry) => entry.id)).toEqual(["early", "late"]);
  });

  test("does not mutate the original queue", () => {
    const original = [item("normal", "normal", 1), item("instant", "instant", 2)];
    const sorted = sortTransferQueue(original);
    expect(original.map((entry) => entry.id)).toEqual(["normal", "instant"]);
    expect(sorted.map((entry) => entry.id)).toEqual(["instant", "normal"]);
  });
});

describe("createInstantTextQueueItem", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  test("uses instant priority", () => {
    expect(createInstantTextQueueItem("msg_1").priority).toBe("instant");
  });

  test("starts queued", () => {
    expect(createInstantTextQueueItem("msg_1").status).toBe("queued");
  });

  test("starts at zero bytes", () => {
    expect(createInstantTextQueueItem("msg_1")).toMatchObject({ sentBytes: 0, totalBytes: 0, progress: 0 });
  });

  test("links the item id", () => {
    expect(createInstantTextQueueItem("msg_1").itemId).toBe("msg_1");
  });

  test("uses current time", () => {
    expect(createInstantTextQueueItem("msg_1").createdAt).toBe(new Date("2026-06-11T12:00:00Z").getTime());
  });

  test("creates queue id prefix", () => {
    expect(createInstantTextQueueItem("msg_1").id).toMatch(/^queue_/);
  });
});
