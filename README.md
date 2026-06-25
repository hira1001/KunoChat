# KunoChat

KunoChat is a tiny Windows/macOS desktop send pocket for two people. It is designed to sit in the upper-right corner, stay quiet, and make text, screenshots, images, files, and bundles feel instant to send.

## Principles

- Free to operate: no paid TURN, hosted storage, or cloud database requirement.
- No cloud file bodies: the embedded WebSocket signaling server exchanges only pairing and WebRTC setup data; WebRTC DataChannel carries message bodies.
- Native desktop feel: normal resizable/movable OS window, optional always-on-top, tray/menu bar, shortcuts, notifications, open/reveal, autostart, single instance, and window positioning.
- Speed first: text and control messages use an instant-priority control channel so large files never block quick chat updates.
- Device continuity: each installed app keeps an Ed25519 device key in the OS secure credential store. A WebRTC channel becomes usable only after mutual signed identity verification; a changed paired key is rejected.

## Stack

- Tauri v2
- React + TypeScript + Vite
- Tailwind CSS
- Zustand
- WebRTC DataChannel instant text transport
- Embedded WebSocket signaling server
- LAN peer discovery
- Optional zero-input Tailscale peer discovery when Tailscale is already installed and logged in
- Local SQLite/store/files for history and received files

## Setup

Install Node.js and npm, then install Rust before running the Tauri app:

```sh
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
npm install
```

For normal installed-app use, no terminal server command is required. Open KunoChat on both computers on the same Wi-Fi/LAN; each app starts its embedded signaling server and discovers the other app automatically. If both computers already use Tailscale, KunoChat also tries to discover reachable Tailscale peers without asking the user for an IP address.

Copy `.env.example` to `.env` only when changing development fallback URLs:

```sh
cp .env.example .env
```

## Development

```sh
npm run dev
npm run typecheck
npm run build
npm run tauri:dev
```

`npm run tauri:dev` runs the native app and starts the embedded signaling server automatically. `npm run signal` and `npm run dev:full` remain available only as web/development fallbacks for testing the standalone Node signaling relay.

## Production Build

```sh
npm run build
npm run tauri:build
```

The app builds as a native Tauri desktop bundle. The installed desktop app does not require `npm run signal`; on the same Wi-Fi/LAN, both users should only open KunoChat. A separate relay URL is only for future remote-network use when the two computers cannot see each other on LAN.

### Windows Prerequisites

- Rust stable
- Node.js 22+
- Microsoft C++ Build Tools / Visual Studio Build Tools
- WebView2 Runtime

### macOS Prerequisites

- Rust stable
- Node.js 22+
- Xcode Command Line Tools

The repository includes `.github/workflows/desktop-build.yml` to build macOS and Windows bundles on their native CI runners.

## Implemented Now

- Tauri v2 app metadata for `KunoChat` with a normal resizable/movable native window.
- White, minimal Main Chat with Mini Pill, Pairing, Settings, composer, attachment preview, and drop overlay.
- Mock-free startup: no fake conversation, no fake typing indicator, no fake connected peer.
- Generated local pairing code with copy action and automatic room waiting for manual fallback.
- Embedded WebSocket signaling server for room join, offer, answer, and ICE relay.
- LAN auto-discovery so two installed apps on the same network can connect without separate setup.
- Tailscale auto-discovery for remote computers that already share a tailnet and have KunoChat open.
- WebRTC `control` DataChannel for instant text, typing, ping/pong, and ACK.
- Mutual device authentication on the control channel, with the paired device public-key fingerprint retained locally for future connections.
- WebRTC `binary` DataChannel for dropped/pasted file and image bodies.
- Native path-backed reads for files selected with the `+` picker, tray Send File, or shortcut entrypoint.
- File transfer metadata/progress/completion over `control`, chunks over `binary`.
- Asset send failures notify the peer over `control` when the instant channel is still alive.
- Active outgoing transfers can be cancelled inline; cancellation is local-first and is relayed to the peer over `control`.
- Bundled files use independent transfer IDs so each binary stream can be tracked separately.
- File integrity verification with SHA-256 metadata and native receive-side hash checks before the final file move.
- Native file reads and part-file writes use reusable Tauri binary file handles; transfer chunks are not expanded into JavaScript number arrays on the critical path.
- LAN/Tailscale auto-connect uses an encrypted Rust-native file stream so file bodies bypass the WebView entirely; WebRTC remains the instant control and fallback transport.
- Image preview generation never blocks an `asset-start` control message or the first binary bytes.
- Received files are saved locally under `Downloads/KunoChat` and keep their saved path for reveal/open flows.
- Optimistic send UX: Send immediately renders locally, clears the composer, then updates `queued -> sending -> received` as the peer requests and verifies file bytes.
- Interrupted outgoing sends become retryable failures instead of getting stuck in `sending`.
- Crash-safe native transfer session records and local UI transfer state persistence. On reconnect, a compatible path-backed outgoing file is re-announced and a receiver resumes from its retained part-file byte count.
- Failed/cancelled outgoing messages expose an inline Retry action and preserve local file references when available.
- Teams-style typing indicator over the same instant control channel.
- Connection-aware composer, drag/drop, paste, and picker behavior.
- Drag & Drop and clipboard attachment parsing in the UI.
- `+` file picker adapter for Tauri dialog with safe web fallback and native chunk reads.
- Local settings and message history persistence in the UI layer.
- Save folder selection from Settings, used by native part-file and final-file writes.
- Strong message/asset/transfer TypeScript types.
- Zustand app state for view, connection status, messages, draft, attachments, transfer states, and settings.
- Native command/plugin boundaries for tray, shortcuts, notifications, file open/reveal, autostart, single instance, close-to-hide, window state, store, SQL, picked-file reads, and received-file saves.
- Desktop icons generated for macOS `.icns`, Windows `.ico`, and PNG sizes.
- CI quality gates for TypeScript, Vitest, Rust tests, frontend build, and Tauri bundle build.
- Release workflow for tested macOS/Windows artifacts on `v*` tags.
- Debug native bundle validation has passed on macOS with Rust installed.

## Next Phases

1. Add an optional public relay for remote networks where neither LAN nor Tailscale can reach the other computer.
2. Add richer transfer controls for pausing, resuming, and per-file cancellation inside bundles.
3. Run two-machine flaky-network and NAT traversal tests, adding TURN only when needed.
4. Keep OS code signing optional; add publisher signing/notarization only if warning-free public distribution becomes necessary.

## Performance Validation

`docs/PERFORMANCE.md` defines the two-machine latency and throughput measurements required before claiming a production performance target. A direct P2P path can reduce relay latency, but no implementation can honestly claim to beat every network, device, and SaaS without measured comparisons.
