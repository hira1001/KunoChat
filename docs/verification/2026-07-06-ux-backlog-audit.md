# UX Backlog Audit

Date: 2026-07-06

## Answer

Not every discussed UX improvement is fully complete yet. The major v0.6.0 home-LAN chat model is implemented, but a few polish and real-device verification items remain.

## Completed or Implemented

- Conversation separation and per-conversation drafts/attachments.
- Sender-side peer selection and non-blocking receiver auto-accept.
- Sending while disconnected as local `送信待ち` instead of an error.
- Header talk selector with unread/pending counts.
- Mini red badge with unread/pending count.
- Image lightbox preview and file card status cleanup.
- Settings redesign and downgrade version selection.
- Compact window sizing and no chat scroll-slide on return.
- Duplicate-prone picked-file ids changed to UUID.
- Large automatic connection banner suppressed for known recipients during passive auto-wait.
- Composer offline explanation bar removed to avoid duplicating the header/pending message state.

## Still Not Fully Closed

- Installed Windows/macOS two-device verification for the latest release.
- OS notification click routing and Windows taskbar badge verification.
- Browser fallback peer-leave detection speed.
- Receiver-side peer display name edge cases where a fallback label can remain `Peer`.
- Internet relay/store-and-forward fallback, intentionally out of scope for the home LAN release.

## Current UX Decision

Connection status should not occupy the chat stream during normal known-recipient auto-wait. The chat surface should show messages first, while connection state stays in the header and pending status stays on the affected messages.
