# Auto Connect Chat Presence Verification

Date: 2026-07-05

## Scope

- After first pairing, known conversations should not require a manual connection button for normal use.
- Opening or selecting a known chat starts automatic reconnect in the background.
- A chat shows online only for the active connected conversation.
- Messages and files can be queued while offline.

## Implementation Evidence

- `src/app/App.tsx`
  - Added active-chat auto reconnect on app focus, resume, chat open, chat select, and offline send.
  - Known-chat connection banner now shows automatic standby instead of making retry the primary action.
  - Selecting another conversation disconnects the previous active connection state before attempting the new one.
- `src/features/chat/chatStore.ts`
  - `setConnectionStatus` now clears connected/connecting/reconnecting state from non-active conversations.
- `src/components/Composer.tsx`
  - Offline composer text clearly says messages are saved to the send queue.
- `src/features/chat/chatStore.test.ts`
  - Added regression test that only the active conversation remains online.

## Verification Commands

```powershell
npm run typecheck
npm test -- --run
npm run build
```

## Results

- TypeScript: passed.
- Vitest: 10 files passed, 196 tests passed.
- Production build: passed.
- In-app browser at `http://127.0.0.1:1420/`: loaded `KunoChat`, composer placeholder showed `オフラインでも送信待ちにできます`, connection banner rendered, console error count was 0.

