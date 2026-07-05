# Debug Evidence - 2026-07-05

## Scope

- Connection flow stuck at `接続中`.
- Browser file/image preview path.
- Pairing UX text and action sizing.
- Removal of signature verification as a connection blocker.

## Root Causes

1. Browser/dev verification could not complete identity setup because non-Tauri `getDeviceIdentity()` threw.
2. The WebRTC control data channel could open after the `onopen` handler was attached, or already be open when attached.
3. Browser-local fallback could mark the client as locally connected and steal sends from an already-open RTC data channel.
4. Browser file picking returned no `File`, so browser previews/sends could not use the selected payload.

## Fixes

- Added a non-Tauri browser device identity fallback.
- Made an open RTC control channel sufficient for `connected`.
- Prioritized RTC control/binary channels over BroadcastChannel fallback when RTC is open.
- Kept BroadcastChannel fallback only as a fallback transport.
- Added browser file picker support with `File` and image preview object URLs.
- Added connection timeout UX so the app does not stay in `接続中` forever.
- Localized visible English labels found in the audited screens.
- Increased small connection banner action button hit areas.

## Verification

- `npm run typecheck`: passed.
- `npm test -- --run`: 10 files passed, 191 tests passed.
- `npm run build`: passed.
- Local signaling server on `8787`: started and accepted connections during verification.
- Real browser verification before final send-priority fix:
  - Pairing reached `オンライン` in both screens.
  - Console errors: none.
  - A later browser-control session timed out during bidirectional message verification, so final bidirectional UI verification is covered by code review plus automated test/build, not by a completed browser transcript.

## Remaining Note

The tracked deletion of `最高の設計書.md` and untracked audit/design files existed before this commit scope and were intentionally not included.
