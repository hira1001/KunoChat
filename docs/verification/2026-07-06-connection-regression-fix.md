# Connection Regression Fix Verification

Date: 2026-07-06

## Problem

The installed Windows app was running and listening on the expected local ports, but peer connection could still fail.

Observed locally:

- Installed app: `0.6.1`
- Process: `kunochat.exe`
- Listening ports: `8787` and `8790`
- Local reachability: `127.0.0.1`, Wi-Fi IPv4, and Tailscale IPv4 all accepted TCP connections on both ports.
- A direct WebSocket `connection-request` probe to `ws://127.0.0.1:8787` returned `connection-request-ack`.

This means the app process and embedded signaling listener were alive. The likely failure point was target address selection.

## Root Cause

Tailscale discovery used the peer DNS name as `peerHint` while also computing a concrete Tailscale IP for reachability. If MagicDNS or DNS resolution was unavailable or inconsistent, the UI could show the peer but subsequent connection/reconnect paths could build `ws://<dns-name>:8787` and fail.

There was also a mode-sensitive URL issue for detected peers:

- If discovery says this device should host, sending a connection request to the discovery `signalingUrl` can accidentally target this device.
- If discovery says this device should join, the discovery `signalingUrl` is already the remote server and should be preserved.

## Fix

- Tailscale `peerHint` now stores the concrete Tailscale IP.
- Tailscale DNS name remains available as the display name.
- Detected-peer connection URL selection now respects discovery mode:
  - `join`: use the discovered `signalingUrl`.
  - `host`: send the connection request to the peer hint address instead.

## Verification

```powershell
npm run typecheck
npm test -- --run
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check --locked
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --locked native::tailscale_discovery --lib
npm run release:preflight -- --tag v0.6.2
```

Results:

- TypeScript passed.
- Vitest passed: 10 files, 196 tests.
- Frontend production build passed.
- Rust `cargo check --locked` passed.
- Tailscale discovery Rust tests passed: 12 tests.
- Release preflight passed for `v0.6.2`.
