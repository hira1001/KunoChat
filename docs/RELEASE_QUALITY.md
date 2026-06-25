# Release Quality

KunoChat is configured to build and publish free, unsigned-at-the-OS-level macOS and Windows desktop bundles only after every platform gate passes. Paid Apple Developer Program and Windows code-signing certificates are optional, not release blockers.

## Current Quality Gates

Every desktop build should pass:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri:build`

The current local evidence is:

- Vitest: 165 passed.
- Cargo: run on every release candidate.
- TypeScript: passed.
- Vite production build: passed.
- Tauri macOS app/DMG bundle: passed locally.
- Packaged macOS app update check: manually verified against the published `v0.2.0` updater endpoint; it returns `アプリは最新のバージョンです。`.

## Release Workflow

`.github/workflows/release.yml` runs only for tags matching `v*`. It verifies that the tag exactly matches the three application version files, confirms the free Tauri updater-signing key exists, creates a private draft release, then builds both platforms in parallel.

It performs the same quality gates before attaching bundles to a GitHub Release:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and `.exe`

The workflow publishes only after both platforms upload their installers and signed updater artifacts. A failed platform job leaves the draft private. The updater endpoint points to GitHub Release `latest.json`; Tauri Action generates that metadata from updater-signed artifacts, and no hand-written update metadata is published from the repository.

## Signing And Notarization Policy

The normal release preflight requires only these free updater-signing secrets:

- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, matching the public key in `tauri.conf.json`.

Paid OS signing is intentionally optional:

- macOS Developer ID signing and notarization can suppress Gatekeeper distribution friction, but requires Apple Developer Program membership.
- Windows Authenticode signing can reduce SmartScreen friction, but requires a trusted certificate or signing service.

Without OS signing, KunoChat can still be built and released for free. The tradeoff is that macOS or Windows may show first-run security warnings that KunoChat cannot honestly remove in code.

## Required Manual Release Checks

- Install the macOS `.dmg` on a clean Mac.
- Install the Windows bundle on a clean Windows PC.
- Confirm the app opens without terminal commands.
- Accept firewall prompts and confirm LAN discovery.
- Confirm Tailscale discovery works without IP entry when both machines are logged into the same tailnet.
- Send text both ways.
- Send image, PDF, and multi-file bundle.
- Confirm a LAN/Tailscale transfer uses TCP port `8790` for file bytes and that instant text remains responsive during a 1 GB transfer.
- Block TCP port `8790` on the receiving machine and confirm the same file falls back to the WebRTC binary path without a false failure state.
- Confirm received files save under the folder currently selected in Settings.
- Confirm corrupted transfer simulation fails integrity verification.
- Confirm app restart does not show fake connected state.
- Confirm OS titlebar, move, resize, minimize, and close behavior.
- Run the two-machine measurements in `docs/PERFORMANCE.md` on both LAN and Tailscale before making any speed claim.
