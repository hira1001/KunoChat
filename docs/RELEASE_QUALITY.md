# Release Quality

KunoChat can now build tested macOS and Windows desktop bundles in CI. True consumer-grade distribution still needs signing credentials owned by the publisher.

## Current Quality Gates

Every desktop build should pass:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri:build`

The current local evidence is:

- Vitest: 161 passed.
- Cargo: 38 passed.
- TypeScript: passed.
- Vite production build: passed.
- Tauri macOS app/DMG bundle: passed; updater artifacts additionally require the publisher-owned `TAURI_SIGNING_PRIVATE_KEY`.

## Release Workflow

`.github/workflows/release.yml` builds both platforms on tag pushes matching `v*`.

It performs the same quality gates before attaching bundles to a GitHub Release:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and `.exe`

The updater endpoint points to GitHub Release `latest.json`. Tauri Action must generate that metadata from the signed updater artifacts; no hand-written update metadata is published from the repository.

## Signing And Notarization Gap

Unsigned apps may show operating-system trust warnings. To reach SaaS-grade distribution quality, add publisher-owned secrets and signing configuration:

- macOS Developer ID certificate.
- Apple notarization credentials.
- Windows code-signing certificate.
- Tauri updater signing key stored as `TAURI_SIGNING_PRIVATE_KEY` and its password, matching the configured public key.
- A release policy that rejects unsigned public releases.

Until those credentials exist, GitHub Releases are suitable for controlled beta testing, not broad consumer distribution.

## Required Manual Release Checks

- Install the macOS `.dmg` on a clean Mac.
- Install the Windows bundle on a clean Windows PC.
- Confirm the app opens without terminal commands.
- Accept firewall prompts and confirm LAN discovery.
- Confirm Tailscale discovery works without IP entry when both machines are logged into the same tailnet.
- Send text both ways.
- Send image, PDF, and multi-file bundle.
- Confirm received files save under the folder currently selected in Settings.
- Confirm corrupted transfer simulation fails integrity verification.
- Confirm app restart does not show fake connected state.
- Confirm OS titlebar, move, resize, minimize, and close behavior.
