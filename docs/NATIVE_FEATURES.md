# Native Features

KunoChat is designed as a native desktop companion for Windows and macOS. The current implementation adds official Tauri plugin dependencies, command boundaries, and initial implementations where safe.

## Current Native Foundation

- System tray/menu bar menu skeleton.
- Single instance plugin registration.
- Normal resizable/movable OS window with native decorations.
- Embedded WebSocket signaling server that starts with the app.
- LAN peer discovery for open-app-only connection on the same network.
- Optional Tailscale peer discovery for open-app-only remote connection when both users already have Tailscale running.
- Native file dialog adapter.
- Native metadata and chunk-read commands for picker-selected files.
- Native SHA-256 command for path-backed file integrity checks.
- Native save command for received files under `Downloads/KunoChat`.
- Open and reveal file commands.
- Native notification command.
- Global shortcut registration for show/hide, file picker, and clipboard-send entrypoints.
- Autostart command.
- Close/minimize behavior follows the native window first; tray hide behavior remains available through commands.
- Window state plugin registration.
- Store and SQL plugin registration.
- Right-top window positioning command.

## macOS Direction

- Menu bar presence.
- Cmd-based shortcuts.
- Reveal in Finder.
- Close means hide.
- Cmd+Q means quit.
- Optional Dock-hidden behavior in a later polish phase.

## Windows Direction

- System tray presence.
- Ctrl-based shortcuts.
- Show in Explorer.
- Close means minimize to tray / hide.
- Toast notifications.
- Taskbar progress for large transfers in a later phase.

## Safety Notes

- File bodies remain local/P2P.
- Tailscale is used only as an optional private network path; KunoChat does not ask users to enter Tailscale IPs.
- Received file bytes are checked against sender SHA-256 metadata before saving when a hash is available.
- Received files are never auto-opened.
- Opener permissions should stay scoped to received files and chosen paths.
- Clipboard access should remain user-gesture driven.
