# v0.6.0 Full UX Release Verification

Date: 2026-07-05

## Scope

- Complete the v0.6.0 LINE-like home LAN UX work, not only the first kickoff.
- Keep manual connection as setup/recovery while known conversations can queue sends without pressing Connect.
- Improve talk switching, queued-send visibility, attachment/image preview UX, and Japanese copy.
- Release a new installer/update version after verification.

## Implemented

- Bumped app version to `0.6.0` across npm, Tauri, and Cargo metadata.
- Header talk selector shows a compact talk list with unread count, last message preview, relative time, online/pending state, and queued-send count.
- Known conversations can show queued sends and allow sending while disconnected.
- Chat header and composer copy now explain offline queued sending in Japanese instead of surfacing raw connection internals.
- Image messages support in-app preview/lightbox.
- Bundle/file cards now distinguish `送信待ち`, `送信中`, `受信中`, `保存待ち`, `完了`, `失敗`, and `取消済み`.
- File and picked attachment ids now use `crypto.randomUUID()` instead of timestamp-based ids.
- Message list return/restore uses immediate scroll positioning to avoid the chat view sliding from top to bottom.

## Verification Commands

```powershell
npm run typecheck
npm test -- --run
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check --locked
npm run release:preflight -- --tag v0.6.0
```

## Results

- TypeScript passed.
- Vitest passed: 10 test files, 196 tests.
- Production frontend build passed.
- Rust/Tauri `cargo check --locked` passed for `kunochat v0.6.0`.
- Release preflight passed for `v0.6.0`.
- Timestamp-only picked file ids were removed from `src`.

## Browser Evidence

In-app browser target: `http://127.0.0.1:1420/`

- Desktop width `1280`: no horizontal overflow.
- Compact width `360`: no horizontal overflow.
- Compact talk selector opens and shows `トーク一覧` plus conversation rows.
- Visible UI text had no mojibake markers.
- Console error count: 0.

## Release Notes

- This release keeps the home LAN profile focused on direct/P2P plus local queued delivery.
- Cloud relay and store-and-forward remain inactive by design for this home-use release.
