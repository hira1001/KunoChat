# UI Real-Screen Audit - 2026-07-04

## Scope

- App URL: `http://127.0.0.1:1420/`
- Browsers used:
  - Codex In-app Browser
  - Chrome extension-controlled browser
- Viewports:
  - In-app Browser desktop: 1280 x 720
  - In-app Browser mobile: 390 x 844
  - Chrome: 958 x 1030
- Screens and flows:
  - Chat main / disconnected state
  - Empty chat state
  - Conversation selector
  - History
  - Settings
  - Pairing
  - Mini mode
  - Composer typing
  - File button / attachment-preview entry point
  - Two-browser pairing attempt

## Summary

The visual shell is stable: no console errors were observed, and the tested screens did not create document-level horizontal scroll. History and mini mode were visually stable.

The serious UI/UX issues are concentrated in the connection and attachment flows:

1. Two-browser pairing did not surface either browser in `Detected devices`.
2. Manual pairing by code stayed on `Connecting` after the Chrome pairing code was entered into the in-app browser and waited for more than 15 seconds.
3. The file button does nothing in browser verification because non-Tauri `pickFiles()` returns an empty list.
4. Pairing, transfer, settings, and header copy still mix English and Japanese.
5. Recovery buttons are too small for mobile/touch usage.

## Positive Findings

- No console errors or warnings in checked screens.
- No document-level horizontal overflow on:
  - Chat main
  - History
  - Settings after transition
  - Pairing
  - Mini mode
- History empty state is clean and Japanese-only.
- Mini mode displayed without clipping and had a 44px-tall visible target.
- Composer typing enables the send button as expected. The audit did not click send.

## Findings

### P0: Two-browser pairing does not actually complete in the browser verification path

Evidence:

- Opened the app in two different browser surfaces: in-app browser and Chrome.
- Opened the pairing screen in both.
- Both screens showed `Detected devices` as `No nearby devices yet.`
- Entered Chrome's code `658-867` into the in-app browser.
- The in-app browser's `Connect` button became enabled.
- After clicking `Connect`, both sides remained on `Connecting` for more than 15 seconds.
- Neither side showed connected state, detected peer state, or a user-recoverable next action.

Observed text:

- In-app Browser after manual code: `Pair a device Connecting ... DETECTED DEVICES No nearby devices yet. ... Connect`
- Chrome after manual code: `Pair a device Connecting ... DETECTED DEVICES No nearby devices yet. ... Connect`

Impact:

- This directly affects the user's central requirement: choose the intended peer and connect without friction.
- A persistent `Connecting` state without timeout guidance makes the user believe the app is stuck.

Source areas to inspect:

- `src/components/PairingScreen.tsx:156`
- `src/components/PairingScreen.tsx:162`
- `src/components/PairingScreen.tsx:190`
- `src/components/PairingScreen.tsx:209`

Recommended fix:

- Add an explicit pairing timeout state with a clear retry/change-peer action.
- Make detected-peer discovery visible and deterministic, or hide `Detected devices` when the current runtime cannot discover peers.
- For manual codes, show a progress sequence such as `コード確認中` -> `相手へ接続中` -> `接続できませんでした`.

### P0: Browser file button is a no-op, so attachment preview cannot be verified there

Evidence:

- In Chrome, clicking `#composer-pick-btn` did not open a browser `filechooser`.
- After the click, there was no visible UI change, no preview, no toast, and no console error.
- Source shows non-Tauri environments return an empty list:
  - `src/features/native/platformAdapter.ts:257`
  - `src/features/native/platformAdapter.ts:259`
- App adds attachments only from `platformAdapter.pickFiles()` results:
  - `src/app/App.tsx:566`
  - `src/app/App.tsx:568`
- Attachment preview renders only when attachments exist:
  - `src/components/AttachmentPreview.tsx:12`
  - `src/components/AttachmentPreview.tsx:57`

Impact:

- Browser-based real-screen verification cannot validate file/image preview.
- Worse, the browser UI still exposes a file button that appears clickable but silently does nothing.

Recommended fix:

- For browser/dev mode, implement a standard hidden `<input type="file" multiple>` fallback.
- Or disable the file button with visible explanation when `hasTauri` is false.
- Native Tauri file preview still needs separate installed-app verification.

### P1: Pairing screen is heavily mixed English/Japanese

Evidence:

- Visible text includes `Pair a device`, `YOUR CODE`, `DETECTED DEVICES`, `No nearby devices yet.`, `Connect`, `Connected`, `Connecting`, `Failed`, `Waiting`.
- Source:
  - `src/components/PairingScreen.tsx:81`
  - `src/components/PairingScreen.tsx:106`
  - `src/components/PairingScreen.tsx:129`
  - `src/components/PairingScreen.tsx:156`
  - `src/components/PairingScreen.tsx:162`
  - `src/components/PairingScreen.tsx:190`
  - `src/components/PairingScreen.tsx:209`

Impact:

- The connection flow is the most important UX surface. Mixed language makes it feel unfinished and less trustworthy.

Recommended fix:

- Fully localize pairing states and actions.

### P1: Pairing copy conflicts with the current home-use/product direction

Evidence:

- Pairing screen says: `このPCは接続後に相手デバイスを記憶し、別の鍵を持つ端末は遮断します。`
- Settings says: `相手PCと接続すると、このPCに相手デバイスの鍵を保存します。`
- Source:
  - `src/components/PairingScreen.tsx:195`
  - `src/components/SettingsScreen.tsx:218`

Impact:

- The user explicitly de-prioritized security/completeness in favor of strong home-use functionality.
- The current copy emphasizes key blocking and device trust, which is the wrong mental model for a LINE-like home chat.

Recommended fix:

- Replace with connection-first copy:
  - `一度接続した相手はチャット一覧に残ります。`
  - `次回からは相手を選ぶだけで送信できます。`

### P1: Windows UI still advertises a Mac shortcut

Evidence:

- Both browsers showed `title="ファイルを選択 (⌘O)"`.
- Source: `src/components/Composer.tsx:83`

Impact:

- Incorrect on Windows.
- Also misleading because global file shortcut behavior was previously removed.

Recommended fix:

- Use `ファイルを選択` only, or calculate platform-specific shortcut text.

### P1: Transfer action/status labels still contain English

Evidence:

- Source:
  - `src/components/FileCard.tsx:132` has `Resume` / `Download`.
  - `src/components/ImageCard.tsx:77` has `Download (...)`.
  - `src/components/MessageBubble.tsx:215` has `Failed`.
  - `src/components/MessageBubble.tsx:223` has `Cancelled`.

Impact:

- This affects file/image workflows, which are core user-facing functions.

Recommended fix:

- Translate to `再開`, `ダウンロード`, `失敗`, `取消済み`.

### P2: Recovery tap targets are too small

Evidence:

- Mobile viewport measurements:
  - Header diagnostic `再接続`: 53 x 24.5
  - Header diagnostic `接続先を選ぶ`: 86 x 24.5
  - Message `取消`: 54 x 24
- Source:
  - `src/app/App.tsx:1533`
  - `src/app/App.tsx:1536`
  - `src/components/MessageBubble.tsx:177`

Impact:

- These controls are used during failure/recovery moments.
- 24px height is not comfortable for touch and is easy to miss.

Recommended fix:

- Raise recovery actions to at least 36px height.
- Prefer a single, full-width recovery action on narrow screens.

### P2: Pairing auto-focuses manual code input

Evidence:

- Mobile pairing screen active element was `#friend-code` immediately after opening pairing.
- Source: `src/components/PairingScreen.tsx:178`

Impact:

- On touch devices this can summon the keyboard immediately.
- It also biases the user toward manual code entry while the product direction is peer selection.

Recommended fix:

- Remove `autoFocus`.

### P2: Settings still uses English option labels

Evidence:

- Visible labels: `Always on top`, `Launch at login`, `Notifications`, `Sound`.
- Source:
  - `src/components/SettingsScreen.tsx:163`
  - `src/components/SettingsScreen.tsx:170`
  - `src/components/SettingsScreen.tsx:177`
  - `src/components/SettingsScreen.tsx:184`

Impact:

- Lower priority than pairing/transfer, but still production polish debt.

### P3: Header/conversation fallback copy still contains English

Evidence:

- `History` aria/title:
  - `src/components/Header.tsx:50`
  - `src/components/Header.tsx:51`
- Empty preview fallback:
  - `src/components/Header.tsx:117`

Impact:

- Mostly affects assistive labels and fallback states, but should be cleaned for consistency.

## Verification Matrix

| Area | Result |
| --- | --- |
| Chat main desktop | Pass layout, fail small recovery targets/copy |
| Chat main mobile | Pass layout, fail small recovery targets/copy |
| Chrome main | Pass layout, same copy/tap issues |
| History | Pass |
| Settings | Pass layout, fail English labels/security-heavy copy |
| Pairing | Fail: English-heavy, auto-focus, no detected peers |
| Two-browser auto-detect | Fail: no peers detected |
| Two-browser manual code | Fail: stayed `Connecting` > 15s |
| Mini mode | Pass basic visual check |
| Composer typing | Pass: send button enables; not sent |
| File button in browser | Fail: no visible response; no preview |

## Next Fix Priority

1. Fix two-browser pairing UX and timeout behavior.
2. Add browser/dev file picker fallback or disable file button outside Tauri.
3. Localize all pairing/transfer/settings/header copy.
4. Remove pairing input `autoFocus`.
5. Enlarge recovery/cancel tap targets.
6. Replace security-heavy pairing copy with connection-first copy.

## Notes

- This audit intentionally did not send a message.
- This audit attempted manual pairing between the two browser surfaces.
- Native installed-app file picker behavior still needs Tauri app verification because browser mode returns no files by design.
