# Codex Implementation Policy

This document is the shared working agreement for Codex agents developing KunoChat on Windows and macOS.

## Purpose

- Keep Windows and macOS work coordinated.
- Make OS-specific changes visible before they are merged.
- Preserve shared application behavior unless a platform difference is intentional.
- Leave enough context for the other Codex agent to continue safely.

## Branches

- `main`: stable shared code and project documentation.
- `codex/windows`: Windows implementation and verification work.
- `codex/macos`: macOS implementation and verification work.

Platform-specific branches should regularly pull or merge from `main`.

## Shared Implementation Rules

- Prefer shared code for behavior that should be identical on Windows and macOS.
- Isolate OS-specific behavior behind clearly named modules, helpers, or configuration.
- Do not change shared behavior for one OS without noting the reason in this document or the sync log.
- Keep changes small enough that the other platform can review and test them.
- Avoid broad refactors while working on platform-specific fixes unless the refactor is required.

## Required Notes Before Finishing Work

Before ending a work session, each Codex agent should update the sync log below.

Each entry should include:

- Date and timezone.
- Branch name.
- What changed.
- What was verified on the actual OS.
- Known issues or follow-up work.
- Files or areas likely to affect the other platform.

## Sync Log

### Template

```md
### YYYY-MM-DD HH:mm TZ - Windows|macOS

- Branch:
- Summary:
- Verified:
- Possible impact on other OS:
- Follow-up:
```

### 2026-06-27 12:21 JST - macOS

- Branch: `main`
- Summary: Installed the published `v0.3.1` macOS release from `KunoChat_0.3.1_universal.dmg` into `/Applications/KunoChat.app`.
- Verified: `/Applications/KunoChat.app` launches, `Info.plist` reports `0.3.1`, the app window renders with the native macOS title bar, and native services listen on TCP `8787` and `8790`.
- Possible impact on other OS: None from this doc-only note. Windows should install `KunoChat_0.3.1_x64-setup.exe` and verify pairing against the same release.
- Follow-up: If pairing remains stuck, use Settings -> Pairing -> Forget paired peer on both machines, then pair again so regenerated device keys are trusted.

### 2026-06-27 12:35 JST - Windows

- Branch: `main`
- Summary: Verified the installed Windows app `KunoChat` from `C:\Users\ymy26\AppData\Local\KunoChat\kunochat.exe`.
- Verified: The installed app is registered as `com.kunochat.desktop`, launches, renders the main window, and opens the Settings screen. The Settings screen shows profile, save folder, Always on top, Launch at login, Notifications, and Sound controls.
- Possible impact on other OS: Current Windows state shows `接続できません / The remote device could not prove its identity.`, so pairing trust may need to be reset on both Windows and macOS before cross-OS message/file transfer verification.
- Follow-up: Use Settings -> Pairing -> Forget paired peer on both machines, then pair again and verify message/file transfer between Windows and macOS.

### 2026-06-27 12:37 JST - Windows

- Branch: `main`
- Summary: Investigated the Windows identity failure. Windows localStorage has no `trustedPeer`, only `peerDisplayName`, so the failure is not a saved trusted-peer mismatch.
- Verified: The error string is emitted only when `verifyDeviceSignature` returns false after receiving `identity-proof`. The current handshake code allows a second `identity-hello` from the same sender/public key to overwrite the stored remote nonce because it only rejects sender/public-key changes, and the control channel is created with `ordered: false`. If a proof generated for the previous nonce arrives after the nonce is overwritten, the verifier builds a different challenge and rejects it as `The remote device could not prove its identity.`
- Possible impact on other OS: Both Windows and macOS can hit this during LAN auto-connect/reconnect races, especially when discovery emits a new connection attempt while authentication messages are still in flight.
- Follow-up: Make the identity handshake deterministic by using an ordered control channel and by treating a changed nonce during the same authentication attempt as stale/invalid instead of overwriting it. Then rebuild/install both OS releases and retry pairing.

### 2026-06-27 12:40 JST - Windows

- Branch: `main`
- Summary: Re-ran installed Windows app verification after pulling latest `main`.
- Verified: Installed `KunoChat` is still version `0.3.1` at `C:\Users\ymy26\AppData\Local\KunoChat\kunochat.exe`, launches as `com.kunochat.desktop`, and listens on TCP `8787`/`8790` plus UDP `8788`. The main window still shows `接続できません / The remote device could not prove its identity.` Pressing `Retry` leaves the app in the same failed state.
- Possible impact on other OS: Confirms the installed Windows release has not received the handshake fix yet. macOS should not expect cross-OS transfer verification to pass against this Windows build.
- Follow-up: Implement the handshake fix, rebuild/install the Windows app, then repeat the same installed-app check and cross-OS pairing test.

### 2026-06-27 12:45 JST - Windows

- Branch: `main`
- Summary: Prepared `v0.3.2` release candidate with deterministic identity handshake handling.
- Verified: `npm run typecheck`, `npm test` (167 passed), `npm run build`, and `node scripts/release-preflight.mjs --tag v0.3.2` passed locally. Local Rust `cargo test` could not be run because `cargo` is not installed on this Windows machine; the GitHub release workflow will run Rust tests on hosted runners before publishing.
- Possible impact on other OS: macOS should install/test the `v0.3.2` release artifact after GitHub Actions publishes it. The fix affects shared WebRTC identity authentication on both Windows and macOS.
- Follow-up: Push tag `v0.3.2`, wait for release workflow success, install new Windows/macOS artifacts, then retry cross-OS pairing and file transfer.

### 2026-06-27 13:01 JST - Windows

- Branch: `main`
- Summary: Published GitHub Release `v0.3.2`.
- Verified: Release workflow run `28277647183` completed successfully. Release is public and includes `KunoChat_0.3.2_universal.dmg`, `KunoChat_0.3.2_x64-setup.exe`, `KunoChat_0.3.2_x64_en-US.msi`, updater signatures, and `latest.json`.
- Possible impact on other OS: Windows and macOS should both install the `v0.3.2` artifacts before retrying pairing, otherwise one side may still run the old unordered identity handshake.
- Follow-up: Install `v0.3.2` on both machines and re-run cross-OS text/file transfer verification.

### 2026-06-27 17:39 JST - macOS

- Branch: `main`
- Summary: Replaced the installed macOS app with the latest published `v0.3.3` release from `KunoChat_0.3.3_universal.dmg`.
- Verified: `/Applications/KunoChat.app` reports `0.3.3`, launches from `/Applications`, renders the main window with native macOS chrome, and listens on TCP `8787` and `8790`.
- Possible impact on other OS: Windows should also install `KunoChat_0.3.3_x64-setup.exe` before cross-OS verification so both sides run the same shared realtime code.
- Follow-up: Pair macOS `v0.3.3` with Windows `v0.3.3`, then verify text send, typing indicator, file transfer, reconnect, and peer-forget recovery.

### 2026-06-27 17:54 JST - Windows

- Branch: `main`
- Summary: Investigated a `v0.3.3` installed-app failure where the UI briefly connected, then immediately changed to `接続できません / The remote device could not prove its identity.`
- Verified: The installed Windows app was `0.3.3`; localStorage still had no saved `trustedPeer`, so the failure was not a trusted-peer mismatch. The remaining race was that identity messages and async signature verification from an old control data channel could still reject the current connection after LAN/Tailscale auto-connect or reconnect overlap.
- Possible impact on other OS: This is shared realtime code. Both Windows and macOS should update to `v0.3.4` once published, because either side can emit stale identity messages during overlapping discovery/reconnect attempts.
- Follow-up: Release `v0.3.4`, update the running Windows app via the in-app updater, and re-test cross-OS pairing.

### 2026-06-27 18:16 JST - Windows

- Branch: `main`
- Summary: Verified the running Windows `v0.3.3` app can update itself to `v0.3.4` through Settings -> App update.
- Verified: The app detected `v0.3.4`, downloaded the update, closed the old window, restarted KunoChat, and then showed `現在のバージョン: v0.3.4` in Settings. `C:\Users\ymy26\AppData\Local\KunoChat\kunochat.exe` also reports `ProductVersion` and `FileVersion` `0.3.4`.
- Possible impact on other OS: Windows is now on `v0.3.4`; macOS should also update to `v0.3.4` before cross-OS pairing is judged again.
- Follow-up: Re-test Windows/macOS pairing and confirm the stale identity proof failure no longer appears after both sides are on `v0.3.4`.

## Current Work

### Windows Codex

- Branch: `codex/windows`
- Current task: Windows installed-app verification.
- Status: `v0.3.2` published. Awaiting installation and real-device cross-OS verification.
- Blockers: Installed Windows app is still the previous local `0.3.1` until the new `v0.3.2` installer is applied.

### macOS Codex

- Branch: `main`
- Current task: macOS installed-app verification for latest release.
- Status: `v0.3.3` is installed in `/Applications/KunoChat.app`, launched, and listening on TCP `8787`/`8790`. The app is currently waiting for pairing.
- Blockers: Cross-OS transfer verification still requires Windows to install and run `v0.3.3`.

## Merge Expectations

- Merge platform branches into `main` only after the relevant OS has been tested.
- If a change affects shared code, the other OS should review or test it before final merge when practical.
- If Windows and macOS need different behavior, document the difference and keep it explicit in code.

## Conflict Resolution

- Prefer preserving shared behavior and adding small OS-specific handling.
- If both branches changed the same area, compare intent before choosing either version.
- When uncertain, write the open question in the sync log instead of guessing silently.
