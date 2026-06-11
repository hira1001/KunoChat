# UI / UX

KunoChat should feel like a quiet upper-right send pocket, not a full chat client.

## Visual Direction

- White background, near-white surfaces, near-black text.
- Very light borders and soft shadows.
- Small, useful buttons only.
- Rounded windows/cards/inputs with consistent radii.
- State color is reserved for connection, progress, warning, and failure.

## Current Screens

- Mini Pill: 188 x 44 white pill with status dot and optional transfer line.
- Main Chat: header, message stream, drop overlay, attachment preview, composer.
- Pairing: own code, friend code input, Connect button, no account/login.
- Settings: display name, save folder, always on top, launch at login, notifications, sound, shortcut, clear history.

## Interaction Rules

- Pressing Send immediately appends a local message.
- A Teams-like typing indicator appears as an avatar, animated dots, and `入力中...`.
- Enter sends; Shift+Enter adds a line break.
- Dragging files over the window shows Drop Overlay.
- Dropping files adds them to Attachment Preview instead of sending immediately.
- Clipboard image/file paste adds attachments.
- The `+` button opens the native file picker in Tauri.

## Language

The initial UI uses short English controls with Japanese support text for clarity. This keeps the surface compact while making errors and setup feel safe.
