import { describe, expect, it } from "vitest";
import {
  deviceKeyForPeer,
  distinctReachablePeers,
  selectAutoPairTarget,
  selectAutoSwitchTarget,
  type AutoConnectPeer
} from "./autoConnect";
import type { ConversationSummary } from "./messageTypes";

const NOW = 1_800_000_000_000;

function peer(overrides: Partial<AutoConnectPeer> = {}): AutoConnectPeer {
  return {
    peerHint: overrides.peerHint ?? "192.168.1.10",
    roomId: overrides.roomId ?? "123456",
    mode: overrides.mode ?? "join",
    signalingUrl: overrides.signalingUrl ?? "ws://192.168.1.10:8787",
    source: overrides.source ?? "lan",
    deviceName: overrides.deviceName,
    platform: overrides.platform,
    reachable: overrides.reachable,
    lastSeen: overrides.lastSeen ?? NOW
  };
}

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: overrides.id ?? "peer_x",
    displayName: overrides.displayName ?? "Peer",
    unreadCount: overrides.unreadCount ?? 0,
    peerHint: overrides.peerHint,
    source: overrides.source,
    lastConnectedAt: overrides.lastConnectedAt,
    stablePeerId: overrides.stablePeerId
  };
}

describe("distinctReachablePeers", () => {
  it("distinct_dedupes_lan_and_tailscale_entries_of_same_device", () => {
    const peers = [
      peer({ peerHint: "192.168.1.10", source: "lan", deviceName: "HomeDesktop", lastSeen: NOW - 1000 }),
      peer({ peerHint: "100.100.123.107", source: "tailscale", deviceName: "HomeDesktop", lastSeen: NOW })
    ];
    const result = distinctReachablePeers(peers, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].peerHint).toBe("100.100.123.107"); // most recent
  });

  it("distinct_excludes_stale_peers", () => {
    const peers = [peer({ deviceName: "A", lastSeen: NOW - 31_000 })];
    expect(distinctReachablePeers(peers, NOW)).toHaveLength(0);
  });

  it("distinct_excludes_unreachable_peers", () => {
    const peers = [
      peer({ peerHint: "1.1.1.1", deviceName: "A", reachable: false }),
      peer({ peerHint: "2.2.2.2", deviceName: "B", reachable: undefined }),
      peer({ peerHint: "3.3.3.3", deviceName: "C", reachable: true })
    ];
    const result = distinctReachablePeers(peers, NOW);
    expect(result.map((p) => p.peerHint).sort()).toEqual(["2.2.2.2", "3.3.3.3"]);
  });
});

describe("selectAutoPairTarget", () => {
  it("pair_target_requires_exactly_one_distinct_peer", () => {
    expect(selectAutoPairTarget([], [], NOW)).toBeUndefined();
    const two = [peer({ peerHint: "1.1.1.1", deviceName: "A" }), peer({ peerHint: "2.2.2.2", deviceName: "B" })];
    expect(selectAutoPairTarget(two, [], NOW)).toBeUndefined();
    const one = [peer({ peerHint: "1.1.1.1", deviceName: "A" })];
    expect(selectAutoPairTarget(one, [], NOW)?.peerHint).toBe("1.1.1.1");
  });

  it("pair_target_suppressed_when_any_known_conversation_exists", () => {
    const one = [peer({ peerHint: "1.1.1.1", deviceName: "A" })];
    const known = [conversation({ id: "peer_known", peerHint: "9.9.9.9" })];
    expect(selectAutoPairTarget(one, known, NOW)).toBeUndefined();
  });
});

describe("selectAutoSwitchTarget", () => {
  it("switch_target_prefers_max_lastConnectedAt_among_detected", () => {
    const conversations = [
      conversation({ id: "a", displayName: "A", peerHint: "1.1.1.1", lastConnectedAt: NOW - 10_000 }),
      conversation({ id: "b", displayName: "B", peerHint: "2.2.2.2", lastConnectedAt: NOW - 1_000 })
    ];
    const peers = [peer({ peerHint: "1.1.1.1", deviceName: "A" }), peer({ peerHint: "2.2.2.2", deviceName: "B" })];
    const result = selectAutoSwitchTarget(conversations, peers, NOW);
    expect(result?.conversation.id).toBe("b");
    expect(result?.matchedPeer?.peerHint).toBe("2.2.2.2");
  });

  it("switch_target_matches_by_deviceName_when_peerHint_differs", () => {
    // Conversation was created from a Tailscale route; the fresh peer is LAN.
    const conversations = [conversation({ id: "hd", displayName: "HomeDesktop", peerHint: "100.100.123.107", lastConnectedAt: NOW - 5000 })];
    const peers = [peer({ peerHint: "192.168.1.51", source: "lan", deviceName: "HomeDesktop" })];
    const result = selectAutoSwitchTarget(conversations, peers, NOW);
    expect(result?.conversation.id).toBe("hd");
    expect(result?.matchedPeer?.peerHint).toBe("192.168.1.51");
  });

  it("switch_target_picks_single_never_connected_detected", () => {
    const conversations = [conversation({ id: "a", displayName: "A", peerHint: "1.1.1.1" })]; // no lastConnectedAt
    const peers = [peer({ peerHint: "1.1.1.1", deviceName: "A" })];
    const result = selectAutoSwitchTarget(conversations, peers, NOW);
    expect(result?.conversation.id).toBe("a");
  });

  it("switch_target_ambiguous_never_connected_returns_undefined", () => {
    const conversations = [
      conversation({ id: "a", displayName: "A", peerHint: "1.1.1.1" }),
      conversation({ id: "b", displayName: "B", peerHint: "2.2.2.2" })
    ];
    const peers = [peer({ peerHint: "1.1.1.1", deviceName: "A" }), peer({ peerHint: "2.2.2.2", deviceName: "B" })];
    expect(selectAutoSwitchTarget(conversations, peers, NOW)).toBeUndefined();
  });

  it("switch_target_returns_undefined_when_nothing_detected", () => {
    const conversations = [
      conversation({ id: "a", displayName: "A", peerHint: "1.1.1.1", lastConnectedAt: NOW - 10_000 }),
      conversation({ id: "b", displayName: "B", peerHint: "2.2.2.2", lastConnectedAt: NOW - 1_000 })
    ];
    const result = selectAutoSwitchTarget(conversations, [], NOW);
    expect(result).toBeUndefined();
  });

  it("switch_target_returns_undefined_with_no_candidates", () => {
    expect(selectAutoSwitchTarget([], [], NOW)).toBeUndefined();
    // Known conversation with no peerHint is not a candidate.
    expect(selectAutoSwitchTarget([conversation({ id: "empty" })], [], NOW)).toBeUndefined();
  });
});

describe("deviceKeyForPeer", () => {
  it("prefers hostname, falls back to peerHint", () => {
    expect(deviceKeyForPeer({ deviceName: "HomeDesktop", peerHint: "1.1.1.1" })).toBe("homedesktop");
    expect(deviceKeyForPeer({ deviceName: undefined, peerHint: "1.1.1.1" })).toBe("1.1.1.1");
  });
});
