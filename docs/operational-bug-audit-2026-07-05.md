# Operational Bug Audit - 2026-07-05

## Scope

- Target: `main` at `c3408674903771d7a3599d4db08e95b7454ea863` (`v0.5.1`)
- Audit time: 2026-07-05 11:59:00 +09:00
- Focus: user-visible operational blockers around connection, reconnect, offline sending, file selection/preview, notifications, updater, and close/exit behavior.

## Verdict

No new P0/P1 operation-blocking defect was found in the local audit.

This is not a claim that no bug can exist. Two release gates were still open at audit time:

- GitHub Actions `Release` workflow was still in progress because the Windows x64 job had not completed.
- Local Rust/Tauri tests could not be run because `cargo` is not installed on this Windows machine.

## Evidence

### Git / Release State

- `git pull --ff-only`: already up to date.
- `git status --short --branch`: branch was `main...origin/main`.
- User-existing dirty/untracked files were left untouched:
  - deleted `最高の設計書.md`
  - untracked `bug_tickets.md`
  - untracked `debug_and_test_report.md`
  - untracked `detailed_causal_debug_report.md`
  - untracked `設計書.md`
- Latest commits:
  - `c340867 Bump version to 0.5.1`
  - `27bf117 Fix pairing transport and browser file flow`

### Local Validation

- `npm run release:preflight -- --tag v0.5.1`: passed.
- `npm run typecheck`: passed.
- `npm test -- --run`: passed, 10 test files / 191 tests.
- `npm run build`: passed.
- `cargo test` in `src-tauri`: not executed, `cargo` command was not available locally.

### Browser Smoke Check

Target: `http://127.0.0.1:1420/`

- HTTP request returned `200`.
- App title rendered as `KunoChat`.
- Console error logs: none observed.
- Main disconnected screen showed:
  - `再接続`
  - `接続先を選ぶ`
  - file picker button with `aria-label="ファイルを選択"`
  - send button with `aria-label="送信"`
- Pairing screen opened from `接続先を選ぶ`.
- Pairing screen showed:
  - own 6-digit code
  - detected-peer area
  - manual peer-code input
  - `接続` button
  - guidance that previously connected peers remain in the chat list.

Note: The in-app browser control surface exposed only one usable tab during this run, so a full two-browser live pairing round trip was not completed in this audit pass.

### Code Path Review

- Close button behavior:
  - `src-tauri/src/lib.rs` handles `WindowEvent::CloseRequested` for `main` with `window.app_handle().exit(0)`.
  - This matches the requirement that X fully exits instead of hiding.
- Tray quit:
  - `src-tauri/src/native/tray.rs` uses `app.exit(0)`.
- Unread indicator:
  - `src-tauri/src/commands/window.rs` updates macOS badge count.
  - Windows requests user attention and updates tray tooltip with unread count.
- Updater UI:
  - `src/components/SettingsScreen.tsx` checks updates, downloads/installs with progress, then relaunches.
- Browser file selection:
  - `src/features/native/platformAdapter.ts` browser fallback creates a hidden file input and returns `File` plus image preview URL.
- Reconnect / connection chooser UX:
  - `src/app/App.tsx` exposes `再接続` and `接続先を選ぶ` when failed/offline.
  - Connection timeout is surfaced with actionable text instead of trapping the user.
- Forced connection request behavior:
  - Incoming connection requests call `autoAcceptConnectionRequest(...)`, so the receiver does not need to manually approve.
- Offline sending:
  - Composer is not disabled by connection state.
  - Store tests cover queued text and file attachments while disconnected and retry after reconnect.

## Findings

### P0 / P1

None found in this audit pass.

### Residual Risks

- Full installed Windows-to-Windows or Windows-to-macOS live pairing could not be re-run here because this audit used the local browser surface and only one active in-app tab was available.
- Release is not complete until the `v0.5.1` Release workflow publishes assets.
- Local Tauri/Rust verification depends on CI until Rust/Cargo is installed locally.

## CI State At Audit Time

Release workflow:

- `Release preflight`: success
- `Create draft release`: success
- `Build macOS universal`: success
- `Build Windows x64`: in progress

Desktop Build workflow:

- `Build macOS`: success
- `Build Windows`: in progress

