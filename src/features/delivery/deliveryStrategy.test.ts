import { describe, expect, test } from "vitest";
import { chooseDeliveryRoute, type DeliveryContext } from "./deliveryStrategy";

function context(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    payloadKind: "text",
    sizeBytes: 120,
    peerOnline: true,
    p2pReady: false,
    p2pConnectingMs: 0,
    relayAvailable: true,
    storeForwardAvailable: true,
    ...overrides
  };
}

describe("delivery strategy", () => {
  test("uses P2P immediately when the direct channel is already ready", () => {
    expect(chooseDeliveryRoute(context({ p2pReady: true }))).toMatchObject({
      route: "p2p",
      ackTarget: "peer",
      reason: "p2p_ready",
      startP2PInBackground: false
    });
  });

  test("sends small text over relay instead of waiting for P2P setup", () => {
    expect(chooseDeliveryRoute(context({ profile: "internet_fallback", p2pConnectingMs: 100 }))).toMatchObject({
      route: "relay",
      ackTarget: "relay",
      reason: "relay_for_small_payload",
      startP2PInBackground: true
    });
  });

  test("keeps small text local while reconnecting in home LAN mode", () => {
    expect(chooseDeliveryRoute(context({ p2pConnectingMs: 100 }))).toMatchObject({
      route: "local_queue",
      ackTarget: "local",
      reason: "give_p2p_first_chance",
      retryAfterMs: 1100,
      startP2PInBackground: true
    });
  });

  test("gives large files a short direct-transfer window before relaying", () => {
    expect(
      chooseDeliveryRoute(
        context({
          payloadKind: "file",
          sizeBytes: 20 * 1024 * 1024,
          p2pConnectingMs: 300
        })
      )
    ).toMatchObject({
      route: "local_queue",
      ackTarget: "local",
      reason: "give_p2p_first_chance",
      retryAfterMs: 900,
      startP2PInBackground: true
    });
  });

  test("falls back to relay when direct setup exceeds the fallback window", () => {
    expect(
      chooseDeliveryRoute(
        context({
          payloadKind: "file",
          sizeBytes: 20 * 1024 * 1024,
          profile: "internet_fallback",
          p2pConnectingMs: 1500
        })
      )
    ).toMatchObject({
      route: "relay",
      ackTarget: "relay",
      reason: "relay_faster_than_waiting"
    });
  });

  test("stores offline payloads when cloud store-and-forward can accept them", () => {
    expect(chooseDeliveryRoute(context({ profile: "internet_fallback", peerOnline: false }))).toMatchObject({
      route: "store_forward",
      ackTarget: "store",
      reason: "store_forward_offline"
    });
  });

  test("keeps offline payloads local by default for home LAN use", () => {
    expect(chooseDeliveryRoute(context({ peerOnline: false }))).toMatchObject({
      route: "local_queue",
      ackTarget: "local",
      reason: "no_remote_route",
      startP2PInBackground: false
    });
  });

  test("keeps oversized offline files local instead of uploading them", () => {
    expect(
      chooseDeliveryRoute(
        context({
          peerOnline: false,
          profile: "internet_fallback",
          payloadKind: "file",
          sizeBytes: 300 * 1024 * 1024
        })
      )
    ).toMatchObject({
      route: "local_queue",
      ackTarget: "local",
      reason: "payload_too_large_for_cloud"
    });
  });

  test("queues locally when no remote fallback is available", () => {
    expect(
      chooseDeliveryRoute(
        context({
          relayAvailable: false,
          storeForwardAvailable: false,
          p2pConnectingMs: 1800
        })
      )
    ).toMatchObject({
      route: "local_queue",
      ackTarget: "local",
      reason: "no_remote_route"
    });
  });
});
