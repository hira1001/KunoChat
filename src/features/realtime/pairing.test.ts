import { describe, expect, it } from "vitest";
import { roleForPair, roomIdForPair } from "./pairing";

describe("roomIdForPair", () => {
  it("deterministic_room_id_matches_for_both_orders", () => {
    expect(roomIdForPair("peer_a", "peer_b")).toBe(roomIdForPair("peer_b", "peer_a"));
  });

  it("deterministic_room_id_is_six_digit_zero_padded", () => {
    expect(roomIdForPair("peer_a", "peer_b")).toMatch(/^\d{6}$/);
    // A pair that hashes to a small remainder must still be zero-padded.
    for (let i = 0; i < 50; i += 1) {
      expect(roomIdForPair(`p${i}`, `q${i}`)).toMatch(/^\d{6}$/);
    }
  });

  it("deterministic_room_id_matches_rust_fixture", () => {
    // Values produced by the Rust room_id_for_pair (source of truth).
    expect(roomIdForPair("left", "right")).toBe("943954");
    expect(roomIdForPair("peer_a", "peer_b")).toBe("345804");
  });
});

describe("roleForPair", () => {
  it("role_for_pair_is_complementary", () => {
    expect(roleForPair("peer_a", "peer_b")).not.toBe(roleForPair("peer_b", "peer_a"));
  });

  it("role_assigns_host_to_lower_id", () => {
    expect(roleForPair("peer_a", "peer_b")).toBe("host");
    expect(roleForPair("peer_b", "peer_a")).toBe("join");
  });
});
