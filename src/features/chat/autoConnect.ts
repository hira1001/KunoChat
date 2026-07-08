import type { ConversationSummary } from "./messageTypes";

// Structural shape of a discovered peer (App.tsx's DetectedPeer satisfies this).
// Defined here to avoid importing App.tsx (which would create a cycle).
export type AutoConnectPeer = {
  peerHint: string;
  roomId: string;
  mode: "host" | "join";
  signalingUrl: string;
  source?: "lan" | "tailscale";
  deviceName?: string;
  platform?: string;
  reachable?: boolean;
  lastSeen: number;
};

// A peer must have announced within this window to count as "present".
export const PEER_FRESH_WINDOW_MS = 30_000;
// The "no peer detected" fallback of auto-switch only dials conversations we
// connected to within this window, so a device last seen weeks ago is not
// dialed forever every 20s (which would also pin the view away from a device
// that appears later).
export const KNOWN_PEER_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The same physical device surfaces as two entries (lan:192.x and tailscale:100.x)
// because the discovery dedupe key is `${source}:${peerHint}`. Fold to one device
// using the hostname when available.
export function deviceKeyForPeer(peer: Pick<AutoConnectPeer, "deviceName" | "peerHint">): string {
  return (peer.deviceName?.trim().toLowerCase() || peer.peerHint).toLowerCase();
}

// Fresh (within window) + reachable peers, deduped to one entry per physical
// device (keeping the most-recently-seen entry). Generic so callers passing a
// richer peer type (e.g. App's DetectedPeer) get that type back.
export function distinctReachablePeers<T extends AutoConnectPeer>(peers: T[], now: number): T[] {
  const byDevice = new Map<string, T>();
  for (const peer of peers) {
    if (now - peer.lastSeen > PEER_FRESH_WINDOW_MS) {
      continue;
    }
    if (peer.reachable === false) {
      continue;
    }
    const key = deviceKeyForPeer(peer);
    const existing = byDevice.get(key);
    if (!existing || peer.lastSeen > existing.lastSeen) {
      byDevice.set(key, peer);
    }
  }
  return Array.from(byDevice.values());
}

function anyKnownConversation(conversations: ConversationSummary[]): boolean {
  return conversations.some((conversation) => Boolean(conversation.peerHint));
}

// Case A: only when NO conversation has a peerHint (true first contact) and
// exactly one distinct reachable peer is present. Otherwise undefined (never
// guess among multiple peers, and never auto-pair once known peers exist).
export function selectAutoPairTarget<T extends AutoConnectPeer>(
  peers: T[],
  conversations: ConversationSummary[],
  now: number
): T | undefined {
  if (anyKnownConversation(conversations)) {
    return undefined;
  }
  const distinct = distinctReachablePeers(peers, now);
  return distinct.length === 1 ? distinct[0] : undefined;
}

function conversationMatchesPeer(conversation: ConversationSummary, peer: AutoConnectPeer): boolean {
  if (conversation.peerHint && conversation.peerHint === peer.peerHint) {
    return true;
  }
  const conversationName = conversation.displayName?.trim().toLowerCase();
  const peerName = peer.deviceName?.trim().toLowerCase();
  return Boolean(conversationName && peerName && conversationName === peerName);
}

// Case C: when the active conversation is empty, choose which known conversation
// to auto-open + dial. Returns the conversation plus (when a fresh detected peer
// matches it on a different route) the matched peer so the caller can update the
// conversation's peerHint before dialing.
export function selectAutoSwitchTarget(
  conversations: ConversationSummary[],
  peers: AutoConnectPeer[],
  now: number
): { conversation: ConversationSummary; matchedPeer?: AutoConnectPeer } | undefined {
  const known = conversations.filter((conversation) => Boolean(conversation.peerHint));
  if (known.length === 0) {
    return undefined;
  }

  const distinct = distinctReachablePeers(peers, now);

  // Match known conversations to a fresh reachable peer.
  const matched = known
    .map((conversation) => ({
      conversation,
      matchedPeer: distinct.find((peer) => conversationMatchesPeer(conversation, peer))
    }))
    .filter((entry): entry is { conversation: ConversationSummary; matchedPeer: AutoConnectPeer } =>
      Boolean(entry.matchedPeer)
    );

  if (matched.length > 0) {
    // (1) Among detected+reachable, prefer the one connected most recently.
    const withHistory = matched.filter((entry) => typeof entry.conversation.lastConnectedAt === "number");
    if (withHistory.length > 0) {
      return withHistory.reduce((best, entry) =>
        (entry.conversation.lastConnectedAt ?? 0) > (best.conversation.lastConnectedAt ?? 0) ? entry : best
      );
    }
    // (2) No connection history among the matches: only pick if unambiguous.
    return matched.length === 1 ? matched[0] : undefined;
  }

  // (3) Nothing detected: do not auto-connect or auto-switch to avoid infinite
  // connection loops to offline peers.
  return undefined;
}
