# Architecture

KunoChat is split into UI, domain state, native integration, signaling, RTC, transfer, and storage layers. The current implementation is mock-free, production-buildable, and includes a live WebRTC instant text path.

## Layers

- UI: `WindowShell`, `MiniPill`, chat cards, composer, pairing, settings, drop overlay.
- State: Zustand stores own current view, connection status, messages, draft text, attachments, transfer states, and settings.
- Native adapter: React calls `platformAdapter`; Rust/Tauri commands handle OS-specific work.
- Embedded signal: `src-tauri/src/native/signal_server.rs` starts with the app and relays room join, offer, answer, and ICE only. It must never carry text bodies or file bodies.
- LAN discovery: `src-tauri/src/native/peer_discovery.rs` broadcasts/listens on the local network and asks the UI to auto-connect when another KunoChat instance appears.
- Tailscale discovery: `src-tauri/src/native/tailscale_discovery.rs` reads `tailscale status --json` when available, probes peer port `8787`, and emits the same auto-connect event without requiring manual IP entry.
- RTC: two WebRTC DataChannels are active: `control` and `binary`.
- Transfer: text, typing, ACK, and asset metadata stay on `control`; file/image bytes stream on `binary`.
- Integrity: asset metadata can include SHA-256; native receivers verify the completed part file before moving it into the selected save folder.
- Storage: local UI persistence is active now; SQLite/store boundaries are present for durable native history and settings.

## Fast Send Model

Sending should feel immediate:

- UI creates the local message as soon as the user presses Send.
- Text/control envelopes use `priority: "instant"`.
- Typing indicators are lightweight control events and should update within the same instant path.
- The WebRTC `control` channel is unordered-but-reliable, reserved for text, typing, ACKs, progress, cancel, retry, and ping/pong.
- The `binary` channel is reserved for file/image chunks only.
- Large file transfer must never block control messages.
- Sender-side SHA-256 runs in parallel with binary transfer; large files do not wait for hashing before bytes start moving.
- On LAN and Tailscale auto-connect routes, file bodies use the native encrypted stream on TCP port `8790`. Rust reads the source file, applies ChaCha20-Poly1305 to each bounded frame, and writes the receiver part file without routing bytes through the WebView.
- The 256-bit native transfer key is generated per transfer and is delivered only through the already encrypted WebRTC control channel. Native TCP headers contain only the transfer ID and per-connection nonce.
- Native direct transfer falls back to the WebRTC binary channel when the receiver endpoint cannot be reached before a native connection is established. Manual pairing keeps the WebRTC binary path because it has no verified direct endpoint.
- Native source files are granted to the Tauri fs scope one exact path at a time, then read through a reusable binary `FileHandle`. This avoids reopening the file and converting every chunk to a JavaScript number array.
- Native receive part files are prepared and size-limited in Rust, then streamed through a reusable binary `FileHandle`. The handle is closed before Rust performs final size and SHA-256 verification plus the atomic move into the save folder.
- Image thumbnail work is outside the `asset-start` path. It must not delay metadata delivery or the peer's transfer request.
- `asset-complete` is not trusted by itself; a receiver completes only after expected binary bytes arrive, native storage confirms the declared size, and the sender hash matches when supplied.
- WebSocket signaling remains setup-only, so send speed does not depend on uploading content to a server.
- Installed desktop apps on the same Wi-Fi/LAN do not need a separate signaling command; the server is embedded in the app process.
- Remote computers on the same Tailscale tailnet can also connect without KunoChat-specific setup when both apps are open and reachable.

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
