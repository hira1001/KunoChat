# Defect Elimination — KunoChat v0.7.0

Date: 2026-07-07
Scope: Bug fixing to raise the app to product quality (no new features beyond the
already-built diagnostics panel). Work order: `docs/DEFECT_ELIMINATION_WORKORDER_2026-07-07.md`.

## Summary

The user's two most-felt symptoms — (a) connections that don't establish or drop,
and (b) wrong/inconsistent UI state — were the priority. The fixes below were
implemented in four batches (connection lifecycle, UI/state consistency, transfer
reliability/leaks, startup/OS robustness) plus the previously-built network
diagnostics panel, all shipped together as v0.7.0.

## Root-cause note (2026-07-06 HomeDesktop incident)

The earlier "cannot connect to HomeDesktop" incident was confirmed by the user to
be simply that KunoChat was **not running** on the remote machine — not a
firewall, bind, or stale-rule problem. The diagnostics panel added here exists to
let users tell those cases apart quickly (device online vs KunoChat actually
listening); it was not the fix for that incident and is not framed as such.

## Verification (all green)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test -- --run` | 239 passed (15 files) |
| `npm run build` | PASS |
| `cargo check --locked` | PASS |
| `cargo test --locked --lib` | 79 passed |
| `npm run release:preflight` | PASS for v0.7.0 |

Test count grew from 209 → 239 (JS) and 69 → 79 (Rust) with targeted tests for
every non-trivial fix.

## Fixes by area

### Connection lifecycle (Batch A) — addresses "won't connect / drops"

- **C-3/C-7 (highest impact)**: `beginIdentityHandshake()` was dead code, so the
  control channel opening faked `identity.verified = true` and reported
  "connected" before the peer's identity was actually verified — the UI showed
  connected while sends threw "identity has not been verified". Now the handshake
  is wired up; status stays "connecting" until identity-hello is verified, with a
  10s timeout that fails closed. `src/features/realtime/realtimeClient.ts`.
- **C-1**: deterministic room/role convergence. Both peers derive the same room
  from `roomIdForPair(stableIdA, stableIdB)` (an FNV port of the Rust discovery
  hash, parity-locked by cross-language fixtures) and complementary host/join
  roles, negotiated via a `proto:2` ack + optional `requesterRole`. Backward
  compatible with v0.6.2 peers (legacy random-room path). Eliminates the
  roomId-mismatch / glare stalls. `src/features/realtime/pairing.ts`, `App.tsx`,
  `signal_server.rs`.
- **C-2**: single-flight `connectGuard` shared by all dial entry points (view
  effect, 20s background worker, focus/online/visibility recovery, conversation
  switch, send-kick, manual retry) — stops overlapping reconnect storms.
- **C-4**: on a signal-server error message, tear the whole transport down so no
  stale socket lingers and no doomed reconnect is scheduled.
- **C-5**: flush queued offline messages only for the conversation the connection
  belongs to (bound at connect time) — never the active tab or all conversations
  (misdelivery hazard).
- **BUG-031**: the signal server now sends WebSocket pings and reaps idle
  connections, and — the bigger fix — runs room cleanup on *every* connection-exit
  path (previously an early `return` on a read error skipped `leave_room`, leaking
  the 2-peer room slot and producing "room already has two peers").

### UI / state consistency (Batch B) — addresses "UI looks wrong"

- **F-B3**: same device reconnecting over a different route (Wi-Fi ⇄ Tailscale,
  DHCP change) no longer forks into duplicate conversation tabs — conversations
  are merged by device fingerprint (`adoptConversationIdentity`).
- **F-B2 / BUG-013**: "cancelled" is now a terminal state; a late
  completion/progress event can't revive or overwrite a cancelled message, so the
  pending badge stays correct.
- **F-B1**: unacked "sent" text is re-delivered on reconnect (idempotent — the
  receiver dedupes by message id). *Deviation:* the work order's aggressive
  "mark failed after 30s" half was intentionally **not** implemented, because it
  would show false failures when only the ack (not the message) was lost;
  reconnect-resend fixes the stuck state without that risk.
- **F-B4 / T-7**: received images render from the saved file after a restart
  (blob URLs dropped once a file is on disk; `ImageCard` falls back to
  `convertFileSrc` on image error) instead of showing a broken image.
- **F-B5 / BUG-032**: quota-safe persist wrapper retries with a trimmed history on
  `QuotaExceededError` instead of corrupting state; oversized (>32KB) thumbnails
  are excluded from persistence.
- **F-B8 / BUG-054**: Tailscale detection now also matches the IPv6 ULA range.
- **F-B6 / F-B7**: already satisfied by existing `isRetryableMessage` (retry
  without a source fails cleanly) and `addAttachments` (30-file / 10 GiB caps) —
  verified, no change needed.

### Transfer reliability & resource leaks (Batch C)

- **F-C2**: bundle retries no longer duplicate already-saved files (dedupe by
  stable item id + skip re-download of a transfer already on disk).
- **F-C3 / F-C4**: startup GC of orphaned `.part` files (>7 days) and leftover
  `KunoChat_Dir_*.zip` temp files (>24h).
- **F-C5**: in-flight WebRTC receives are failed when the binary channel closes
  with no reconnect, instead of sitting at N% forever.
- **F-C6**: oversized WebRTC-only receives (>512 MiB) are rejected before being
  accumulated in renderer memory (OOM guard).
- **F-C7** (small, high-confidence): nonce sequence overflow returns an error
  instead of panicking (BUG-038); temp names use OS RNG (BUG-044);
  `dunce::canonicalize` avoids the Windows `\\?\` prefix that broke the fs scope
  (BUG-022); atomic `create_new` reservation prevents same-name overwrite races
  (BUG-068); tray "open downloads" verifies the folder first (BUG-042).
- **F-C8**: blob preview URLs are revoked when clearing history.

*Deviation:* F-C1 (native-transfer fallback) — investigation showed the existing
code already falls back correctly (receiver `prepareNativeReceive` failure →
WebRTC `request-transfer`; sender connection failure → `executeTransfer`) and is
bounded by real timeouts (4s native connect → fallback, 5-min frame-idle → fail).
The audit's "0% forever" is bounded, not infinite. Rather than re-plumb a new
`native-fallback` control message (high risk without a 2-device test), the safe
receiver-side stall watchdog (F-C5) was added. Flagged for a future 2-device pass.

### Startup / OS robustness (Batch D)

- **F-D1 (BUG-058)**: a global shortcut already taken by another app logs a
  warning instead of crashing startup.
- **F-D2 (BUG-059)**: a minimized window is restored on second launch.
- **F-D3 (BUG-061)**: the tray icon is bound explicitly so `build()` can't fail
  for lack of one.

## Legacy `bug_tickets.md` (80 items) reconciliation

The repo's `bug_tickets.md` is an older audit. All 80 were re-checked against
current code (work order §3). Roughly half were already fixed or false positives
(e.g. IME guard, sanitize_filename, MAX_FRAME_BYTES cap, ping/pong heartbeat,
sync_all only-at-completion, dbQueue serialization, unlisten cleanup). Security
items (handshake encryption, join auth, signing domain separation, trusted-key
SQLite migration, fs_scope shrink, disabling connection auto-accept) are **out of
scope** per the user (home use; reliability over security). Multi-NIC discovery
(BUG-001/018/078), pre-receive disk-space check (BUG-045), IPC perf (BUG-056), and
attach-time thumbnails (BUG-067) are deferred with reasons in the work order.

## Not verified on hardware

Two-device Windows/Tailscale smoke testing was not performed this session (no
second device available). The deterministic-room negotiation, glare handling,
native fallback, and image-after-restart flows are covered by unit tests and code
review but should get a 2-device pass. **Both machines must run v0.7.0**: the
identity-handshake gating (C-3/C-7) intentionally fails closed against a v0.6.2
peer that never sends identity-hello — this is a deliberate behavior change, noted
in the release.

## Commits

- `e743389` Add network diagnostics and fix connection lifecycle defects
- `cba3c41` Fix UI/state consistency defects
- `a4aec69` Fix transfer reliability and resource leaks; startup/OS robustness
- (release commit) Release v0.7.0
