# Architecture

KunoChat is split into UI, domain state, native integration, signaling, RTC, transfer, and storage layers. The current implementation is mock-free, production-buildable, and includes a live WebRTC instant text path.

## Layers

- UI: `WindowShell`, `MiniPill`, chat cards, composer, pairing, settings, drop overlay.
- State: Zustand stores own current view, connection status, messages, draft text, attachments, transfer states, and settings.
- Native adapter: React calls `platformAdapter`; Rust/Tauri commands handle OS-specific work.
- Signal: `server/signaling-server.mjs` relays room join, offer, answer, and ICE only. It must never carry text bodies or file bodies.
- RTC: two WebRTC DataChannels are active: `control` and `binary`.
- Transfer: text, typing, ACK, and asset metadata stay on `control`; file/image bytes stream on `binary`.
- Storage: local UI persistence is active now; SQLite/store boundaries are present for durable native history and settings.

## Fast Send Model

Sending should feel immediate:

- UI creates the local message as soon as the user presses Send.
- Text/control envelopes use `priority: "instant"`.
- Typing indicators are lightweight control events and should update within the same instant path.
- The WebRTC `control` channel is reserved for text, typing, ACKs, progress, cancel, retry, and ping/pong.
- The `binary` channel is reserved for file/image chunks only.
- Large file transfer must never block control messages.
- WebSocket signaling remains setup-only, so send speed does not depend on uploading content to a server.

## Native Boundary

React calls a stable adapter:

- `showMainWindow`, `hideMainWindow`, `positionTopRight`
- `openPath`, `revealPath`
- `showNotification`
- `setAlwaysOnTop`
- `setAutostart`
- `pickFiles`
- `getFileMetadata`, `readFileChunk`
- `saveReceivedFile`

Rust modules are grouped by command responsibility under `src-tauri/src/commands` and OS lifecycle helpers under `src-tauri/src/native`.

## Local Data

The local storage default is `~/Downloads/KunoChat` for received files and `sqlite:kunochat.db` for future native metadata. File bodies and history are not stored in the cloud.
