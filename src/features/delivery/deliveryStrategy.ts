export type DeliveryPayloadKind = "control" | "text" | "image" | "file";

export type DeliveryProfile = "home_lan" | "internet_fallback";

export type DeliveryRoute = "p2p" | "relay" | "store_forward" | "local_queue";

export type DeliveryAckTarget = "peer" | "relay" | "store" | "local";

export type DeliveryDecision = {
  route: DeliveryRoute;
  ackTarget: DeliveryAckTarget;
  reason:
    | "p2p_ready"
    | "give_p2p_first_chance"
    | "relay_faster_than_waiting"
    | "relay_for_small_payload"
    | "store_forward_offline"
    | "payload_too_large_for_cloud"
    | "no_remote_route";
  retryAfterMs?: number;
  startP2PInBackground: boolean;
};

export type DeliveryContext = {
  profile?: DeliveryProfile;
  payloadKind: DeliveryPayloadKind;
  sizeBytes: number;
  peerOnline: boolean;
  p2pReady: boolean;
  p2pConnectingMs: number;
  relayAvailable: boolean;
  storeForwardAvailable: boolean;
  relayMaxBytes?: number;
  storeForwardMaxBytes?: number;
  p2pFallbackMs?: number;
};

const DEFAULT_P2P_FALLBACK_MS = 1200;
const DEFAULT_RELAY_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_STORE_FORWARD_MAX_BYTES = 25 * 1024 * 1024;
const INSTANT_PAYLOAD_BYTES = 64 * 1024;

export function chooseDeliveryRoute(input: DeliveryContext): DeliveryDecision {
  const profile = input.profile ?? "home_lan";
  const p2pFallbackMs = input.p2pFallbackMs ?? DEFAULT_P2P_FALLBACK_MS;
  const relayMaxBytes = input.relayMaxBytes ?? DEFAULT_RELAY_MAX_BYTES;
  const storeForwardMaxBytes = input.storeForwardMaxBytes ?? DEFAULT_STORE_FORWARD_MAX_BYTES;
  const cloudRoutesEnabled = profile === "internet_fallback";
  const cloudEligible = input.sizeBytes <= Math.max(relayMaxBytes, storeForwardMaxBytes);
  const relayEligible = cloudRoutesEnabled && input.relayAvailable && input.sizeBytes <= relayMaxBytes;
  const storeEligible = cloudRoutesEnabled && input.storeForwardAvailable && input.sizeBytes <= storeForwardMaxBytes;
  const instantPayload = input.payloadKind === "control" || input.payloadKind === "text" || input.sizeBytes <= INSTANT_PAYLOAD_BYTES;

  if (input.p2pReady) {
    return {
      route: "p2p",
      ackTarget: "peer",
      reason: "p2p_ready",
      startP2PInBackground: false
    };
  }

  if (!input.peerOnline) {
    if (storeEligible) {
      return {
        route: "store_forward",
        ackTarget: "store",
        reason: "store_forward_offline",
        startP2PInBackground: false
      };
    }

    return {
      route: "local_queue",
      ackTarget: "local",
      reason: cloudEligible ? "no_remote_route" : "payload_too_large_for_cloud",
      retryAfterMs: p2pFallbackMs,
      startP2PInBackground: false
    };
  }

  if (relayEligible && instantPayload) {
    return {
      route: "relay",
      ackTarget: "relay",
      reason: "relay_for_small_payload",
      startP2PInBackground: true
    };
  }

  if (input.p2pConnectingMs < p2pFallbackMs) {
    return {
      route: "local_queue",
      ackTarget: "local",
      reason: "give_p2p_first_chance",
      retryAfterMs: p2pFallbackMs - input.p2pConnectingMs,
      startP2PInBackground: true
    };
  }

  if (relayEligible) {
    return {
      route: "relay",
      ackTarget: "relay",
      reason: "relay_faster_than_waiting",
      startP2PInBackground: true
    };
  }

  return {
    route: "local_queue",
    ackTarget: "local",
    reason: cloudEligible ? "no_remote_route" : "payload_too_large_for_cloud",
    retryAfterMs: p2pFallbackMs,
    startP2PInBackground: true
  };
}
