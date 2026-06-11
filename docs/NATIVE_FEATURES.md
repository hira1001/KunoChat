# Native Features

KunoChat is designed as a native desktop companion for Windows and macOS. The current implementation adds official Tauri plugin dependencies, command boundaries, and initial implementations where safe.

## Current Native Foundation

- System tray/menu bar menu skeleton.
- Single instance plugin registration.
- Native file dialog adapter.
- Native metadata and chunk-read commands for picker-selected files.
- Native save command for received files under `Downloads/KunoChat`.
- Open and reveal file commands.
- Native notification command.
- Global shortcut registration for show/hide, file picker, and clipboard-send entrypoints.
- Autostart command.
- Close-to-hide behavior for the main window.
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
- Received files are never auto-opened.
- Opener permissions should stay scoped to received files and chosen paths.
- Clipboard access should remain user-gesture driven.
