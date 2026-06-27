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

## Current Work

### Windows Codex

- Branch: `codex/windows`
- Current task: Windows installed-app verification.
- Status: `v0.3.2` release candidate prepared with handshake fix. Awaiting GitHub release workflow and new installed artifact verification.
- Blockers: Local Rust toolchain is unavailable on this Windows machine; hosted GitHub Actions must complete `cargo test` and bundle builds.

### macOS Codex

- Branch: `codex/macos`
- Current task:
- Status:
- Blockers:

## Merge Expectations

- Merge platform branches into `main` only after the relevant OS has been tested.
- If a change affects shared code, the other OS should review or test it before final merge when practical.
- If Windows and macOS need different behavior, document the difference and keep it explicit in code.

## Conflict Resolution

- Prefer preserving shared behavior and adding small OS-specific handling.
- If both branches changed the same area, compare intent before choosing either version.
- When uncertain, write the open question in the sync log instead of guessing silently.
