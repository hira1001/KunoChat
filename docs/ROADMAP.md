# Roadmap

## Phase 1: UI Foundation

- Complete Mini Pill, Main Chat, Pairing, Settings, Composer, Drop Overlay, Attachment Preview.
- Start without fake messages, fake typing, or fake connected peers.
- Keep Send guarded until a real peer connection exists.

## Phase 2: Local Experience

- Persist settings and local message metadata.
- Move persisted message metadata to SQLite.
- Generate image thumbnails.
- Save received files under `~/Downloads/KunoChat`.

## Phase 3: Pairing

- Add bundled WebSocket signaling as setup-only transport.
- Generate pairing code and room ID.
- Exchange offer/answer/ICE without sending content through signaling.

## Phase 4: Instant Text

- Open WebRTC control channel.
- Send text/control envelopes with instant priority.
- Send typing start/stop events over the same instant control path.
- Add ACK handling.
- Keep local optimistic rendering.

## Phase 5: File Transfer

- Open binary channel.
- Send asset init/ready/progress/complete/failed messages over control.
- Stream chunks with backpressure over binary.
- Support dropped/pasted file bodies.
- Support native path-backed reads for dialog-picked files.
- Save received assets locally.
- Verify sha256.

## Phase 6: Native Polish

- Expand tray/menu events with send clipboard behavior.
- Harden shortcut conflict handling and customization.
- Validate close-to-hide/minimize-to-tray behavior on Windows.
- Validate notifications, autostart, and window positioning on Windows/macOS.

## Phase 7: Quality

- Test large files, flaky networks, offline peer, and reconnect.
- Add retry/resume flows.
- Refine accessibility and reduced motion.
- Prepare signed distribution later without adding paid infrastructure.
