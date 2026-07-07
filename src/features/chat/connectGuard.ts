// Single-flight guard for connection attempts. There is only one realtimeClient,
// so at most one dial may be in flight at a time (a dial for conversation B while
// A is dialing would tear A down anyway). On top of that, per-conversation
// spacing throttles repeated dials of the same conversation.
//
// All entry points (view effect, background reconnect interval, focus/online/
// visibility recovery, conversation switch, send-kick, manual retry) funnel
// through one shared guard so they can never spam overlapping connection-requests.

export type ConnectGuard = {
  begin(conversationId: string, opts?: { force?: boolean; now?: number }): boolean;
  end(conversationId: string): void;
};

export function createConnectGuard(minSpacingMs = 8_000): ConnectGuard {
  let inFlight: string | undefined;
  const lastAttemptAt = new Map<string, number>();
  return {
    begin(conversationId, { force = false, now = Date.now() } = {}) {
      // Single-flight: never bypassed, not even by force.
      if (inFlight !== undefined) {
        return false;
      }
      // Spacing: force may skip the minimum spacing, but not the in-flight lock.
      // A never-attempted conversation counts as "infinitely long ago" so the
      // first dial always passes (even at now=0 in tests).
      if (!force && now - (lastAttemptAt.get(conversationId) ?? Number.NEGATIVE_INFINITY) < minSpacingMs) {
        return false;
      }
      inFlight = conversationId;
      lastAttemptAt.set(conversationId, now);
      return true;
    },
    end(conversationId) {
      if (inFlight === conversationId) {
        inFlight = undefined;
      }
    }
  };
}
