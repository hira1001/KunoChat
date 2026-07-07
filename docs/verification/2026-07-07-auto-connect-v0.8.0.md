# Selection-free Auto-Connect — KunoChat v0.8.0

Date: 2026-07-07
Work order: `docs/AUTO_CONNECT_WORKORDER_2026-07-07.md`

## Goal

Remove the "select a peer" friction. Opening the app should connect to your usual
peer with no click; true first contact with a single detected device pairs
automatically. Built on the v0.7.0 connection foundation (deterministic rooms,
connectGuard, identity gating, fingerprint merge, reachability, 20s worker).

## A / B / C implementation map

| Case | Behavior | Where |
| --- | --- | --- |
| **A** auto-pair | True first contact (no known peerHint conversation) + exactly one fresh, reachable, device-deduped peer → auto `handleConnectDetectedPeer({auto:true})` | `selectAutoPairTarget` (autoConnect.ts), engine in App.tsx `runAutoConnectTick` |
| **B** auto-register | Tailscale discovery payloads are registered into the conversation list passively (no dial), so they appear as chats and Case C can pick them | `registerConversation` (chatStore.ts), `kuno:auto-connect` listener (App.tsx) |
| **C** auto-select | When the active conversation is empty, pick a known conversation (detected+reachable by max `lastConnectedAt`, else single never-connected detected, else non-stale most-recent) and `handleSelectConversation` (force-dials) | `selectAutoSwitchTarget` (autoConnect.ts), engine |

Engine fires from three points, all synchronous, guarded, view main/mini + not
connected/connecting only: launch mount effect, every `kuno:auto-connect` event,
and the 20s background worker.

## Design decisions (per user)

- A applies to **both LAN and Tailscale** (home-Wi-Fi assumption).
- **No settings toggle** — always on.
- C **only auto-switches when the active conversation is empty** (never yanks the
  user off a conversation they are viewing).
- B registers **Tailscale peers only** (tailnet = the user's own devices); LAN
  peers are not auto-registered (shared Wi-Fi could surface a neighbor). LAN
  first-contact is still handled by A's "exactly one device" rule.

## Robustness fixes carried from the design review (all implemented)

1. `applyLastAutoConnect` sets `lastAutoConnectRef` **synchronously** on every
   dial path, so the acceptor-side glare guard never compares against a stale
   room during simultaneous two-sided auto-dials.
2. Device unification: both `registerConversation` and `handleConnectDetectedPeer`
   resolve a device to one conversation via `matchConversationByDevice`
   (stablePeerId → hostname → peerHint id), so LAN/Tailscale routes of the same
   device never fork a tab.
3. `handleConnectDetectedPeer` takes the single-flight guard first, bails before
   destructive side effects, awaits `connectRealtime`, and releases the guard in
   `finally` on all paths.
4. Auto-invoked pairing does not steal the window from mini view.
5. Case C's undetected fallback is bounded to devices connected within 30 days.
6. Header hides the empty default conversation (keeps it while active).

## Verification (all green)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test -- --run` | 257 passed (16 files) — +18 (autoConnect 13, registerConversation 5) |
| `npm run build` | PASS |
| `cargo check --locked` | PASS (no Rust change) |
| `npm run release:preflight` | PASS for v0.8.0 |

New pure-logic tests in `src/features/chat/autoConnect.test.ts` cover the dedup,
freshness, reachability, pair, and switch-priority rules. `chatStore.test.ts`
adds register-without-activate, reroute-without-split (the anti-fork regression),
stableId/displayName resolution, and unread/message preservation.

## Not verified on hardware

Two-device Windows/Tailscale smoke was not run (no second device). Auto-pair,
two-sided glare convergence, and tailnet auto-registration appearing in the
header need a 2-device pass. Both peers must run v0.7.0+ (identity gating).

## Known accepted behavior (by design, not bugs)

- Case A does not fire once any known conversation exists (a new LAN-only device
  then needs a manual pair — safe side).
- Same-hostname distinct machines fold to one device (rare at home; surfaces as a
  fingerprint-mismatch diagnostic after connect).
- Startup "reconnecting" restore delays the first dial until the 16s timeout.
