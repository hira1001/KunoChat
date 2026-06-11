# KunoChat

KunoChat is a tiny Windows/macOS desktop send pocket for two people. It is designed to sit in the upper-right corner, stay quiet, and make text, screenshots, images, files, and bundles feel instant to send.

## Principles

- Free to operate: no paid TURN, hosted storage, or cloud database requirement.
- No cloud file bodies: the WebSocket signaling server exchanges only pairing and WebRTC setup data; WebRTC DataChannel carries message bodies.
- Native desktop feel: tray/menu bar, shortcuts, notifications, open/reveal, autostart, single instance, and window positioning.
- Speed first: text and control messages use an instant-priority control channel so large files never block quick chat updates.

## Stack

- Tauri v2
- React + TypeScript + Vite
- Tailwind CSS
- Zustand
- WebRTC DataChannel instant text transport
- Bundled WebSocket signaling server
- Local SQLite/store/files for history and received files

## Setup

Install Node.js and npm, then install Rust before running the Tauri app:

```sh
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
npm install
```

Copy `.env.example` to `.env` when changing the signaling URL:

```sh
cp .env.example .env
```

For two computers on the same Wi-Fi/LAN, run `npm run signal` on one computer and set both apps to that computer's LAN IP. Example when the signaling computer is `192.168.64.76`:

```env
VITE_SIGNALING_URL=ws://192.168.64.76:8787
VITE_STUN_URL=stun:stun.l.google.com:19302
SIGNALING_PORT=8787
```

## Development

```sh
npm run dev
npm run signal
npm run typecheck
npm run build
npm run tauri:dev
```

`npm run signal` starts the local signaling server on port `8787`. `npm run dev:full` starts signaling and Vite together on macOS or Windows. `npm run tauri:dev` requires Rust/Cargo and Tauri platform prerequisites.

## Production Build

```sh
npm run build
npm run tauri:build
```

The app builds as a native Tauri desktop bundle. Run a reachable signaling server and set `VITE_SIGNALING_URL` for live pairing across machines.

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

- Tauri v2 app metadata for `KunoChat` with a 360 x 560 frameless window.
- White, minimal Main Chat with Mini Pill, Pairing, Settings, composer, attachment preview, and drop overlay.
- Mock-free startup: no fake conversation, no fake typing indicator, no fake connected peer.
- Generated local pairing code with copy action and automatic room waiting.
- Bundled WebSocket signaling server for room join, offer, answer, and ICE relay.
- WebRTC `control` DataChannel for instant text, typing, ping/pong, and ACK.
- WebRTC `binary` DataChannel for dropped/pasted file and image bodies.
- Native path-backed reads for files selected with the `+` picker, tray Send File, or shortcut entrypoint.
- File transfer metadata/progress/completion over `control`, chunks over `binary`.
- Received files are saved locally under `Downloads/KunoChat` and keep their saved path for reveal/open flows.
- Optimistic send UX: Send immediately renders locally, clears the composer, then updates `sending -> sent -> received`.
- Teams-style typing indicator over the same instant control channel.
- Connection-aware composer, drag/drop, paste, and picker behavior.
- Drag & Drop and clipboard attachment parsing in the UI.
- `+` file picker adapter for Tauri dialog with safe web fallback and native chunk reads.
- Local settings and message history persistence in the UI layer.
- Save folder selection from Settings.
- Strong message/asset/transfer TypeScript types.
- Zustand app state for view, connection status, messages, draft, attachments, transfer states, and settings.
- Native command/plugin boundaries for tray, shortcuts, notifications, file open/reveal, autostart, single instance, close-to-hide, window state, store, SQL, picked-file reads, and received-file saves.
- Desktop icons generated for macOS `.icns`, Windows `.ico`, and PNG sizes.
- Debug native bundle validation has passed on macOS with Rust installed.

## Next Phases

1. Deploy the WebSocket signaling server behind TLS for remote networks.
2. Add reconnect/session resume and resend for interrupted connections.
3. Add sha256 verification and retry/resume for interrupted asset transfers.
4. Run two-machine flaky-network and NAT traversal tests, adding TURN only when needed.
5. Polish OS-specific notification permissions, Windows taskbar progress, notarization/signing, and release distribution.
