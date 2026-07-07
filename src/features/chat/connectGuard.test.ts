import { describe, expect, it } from "vitest";
import { createConnectGuard } from "./connectGuard";

describe("createConnectGuard", () => {
  it("second_attempt_within_spacing_is_rejected", () => {
    const guard = createConnectGuard(8_000);
    expect(guard.begin("A", { now: 0 })).toBe(true);
    guard.end("A");
    expect(guard.begin("A", { now: 1_000 })).toBe(false);
    expect(guard.begin("A", { now: 8_000 })).toBe(true);
  });

  it("force_bypasses_spacing_but_not_inflight", () => {
    const guard = createConnectGuard(8_000);
    expect(guard.begin("A", { now: 0 })).toBe(true);
    // In flight: even force cannot start a second attempt.
    expect(guard.begin("A", { force: true, now: 100 })).toBe(false);
    guard.end("A");
    // Now free: force skips the spacing that would otherwise reject.
    expect(guard.begin("A", { force: true, now: 100 })).toBe(true);
  });

  it("inflight_blocks_other_conversations_too", () => {
    const guard = createConnectGuard(8_000);
    expect(guard.begin("A", { now: 0 })).toBe(true);
    expect(guard.begin("B", { now: 0 })).toBe(false);
    expect(guard.begin("B", { force: true, now: 0 })).toBe(false);
    guard.end("A");
    expect(guard.begin("B", { now: 0 })).toBe(true);
  });

  it("attempt_allowed_after_end_and_spacing_elapsed", () => {
    const guard = createConnectGuard(8_000);
    expect(guard.begin("A", { now: 0 })).toBe(true);
    guard.end("A");
    expect(guard.begin("A", { now: 4_000 })).toBe(false);
    expect(guard.begin("A", { now: 8_001 })).toBe(true);
  });

  it("end_only_clears_the_matching_conversation", () => {
    const guard = createConnectGuard(8_000);
    expect(guard.begin("A", { now: 0 })).toBe(true);
    // Ending a different conversation must not release the in-flight lock.
    guard.end("B");
    expect(guard.begin("C", { force: true, now: 0 })).toBe(false);
    guard.end("A");
    expect(guard.begin("C", { force: true, now: 0 })).toBe(true);
  });
});
