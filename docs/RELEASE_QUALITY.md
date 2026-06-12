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

- Vitest: 145 passed.
- Cargo: 34 passed.
- TypeScript: passed.
- Vite production build: passed.
- Tauri macOS release bundle: passed.

## Release Workflow

`.github/workflows/release.yml` builds both platforms on tag pushes matching `v*` and on manual dispatch.

It performs the same quality gates before attaching bundles to a GitHub Release:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and `.exe`

## Signing And Notarization Gap

Unsigned apps may show operating-system trust warnings. To reach SaaS-grade distribution quality, add publisher-owned secrets and signing configuration:

- macOS Developer ID certificate.
- Apple notarization credentials.
- Windows code-signing certificate.
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
- Confirm received files save under `Downloads/KunoChat`.
- Confirm corrupted transfer simulation fails integrity verification.
- Confirm app restart does not show fake connected state.
- Confirm OS titlebar, move, resize, minimize, and close behavior.
