# UI Audit Evidence - 2026-07-04

## Scope

- Target: `http://127.0.0.1:1420/`
- Viewports:
  - Desktop: 1280 x 720
  - Mobile: 390 x 844
- Screens checked:
  - Main chat / disconnected state
  - History
  - Settings
  - Pairing
  - Conversation selector
- Method:
  - In-app browser DOM inspection
  - Console error/warning check
  - Source line confirmation with `rg` and targeted file reads

## Positive Findings

- No console errors or warnings were observed in the checked screens.
- Desktop and mobile chat views did not create document-level horizontal scroll.
- History empty state had no layout overflow and used Japanese visible copy.
- Settings screen had a transient horizontal offset during the enter animation, but it disappeared after the animation settled. This was not counted as a defect.
- Icon-only header controls had accessible labels, except where noted for language consistency.

## Findings

### P1: Pairing screen is still mixed English/Japanese and does not match the current product direction

Evidence:

- Visible pairing screen text included: `Pair a device`, `YOUR CODE`, `DETECTED DEVICES`, `No nearby devices yet.`, `Connect`, `Connecting`.
- Source:
  - `src/components/PairingScreen.tsx:81`
  - `src/components/PairingScreen.tsx:106`
  - `src/components/PairingScreen.tsx:129`
  - `src/components/PairingScreen.tsx:156`
  - `src/components/PairingScreen.tsx:162`
  - `src/components/PairingScreen.tsx:190`
  - `src/components/PairingScreen.tsx:209`

Impact:

- The app is currently operated by a Japanese user and is being shaped toward LINE-like use. Mixed English on the most failure-prone screen makes the connection flow feel unfinished.
- The pairing screen also still says that devices with another key are blocked, while current product direction is home-use-first and security/completeness is secondary.

Recommended fix:

- Localize all pairing labels/statuses/actions to Japanese.
- Replace security-heavy copy with connection-first copy, for example: "一度接続した相手は次回からチャット一覧に残ります。"

### P1: File/image transfer actions still show English labels

Evidence:

- Source:
  - `src/components/FileCard.tsx:132` shows `Resume` / `Download`.
  - `src/components/ImageCard.tsx:77` shows `Download (...)`.
  - `src/components/MessageBubble.tsx:215` shows `Failed`.
  - `src/components/MessageBubble.tsx:223` shows `Cancelled`.

Impact:

- This directly affects the file/image feature the user repeatedly reported as important.
- Transfer state/action wording is inconsistent with the Japanese chat UI.

Recommended fix:

- Use Japanese labels consistently:
  - `Download` -> `ダウンロード`
  - `Resume` -> `再開`
  - `Failed` -> `失敗`
  - `Cancelled` -> `取消済み`

### P1: Windows build shows a Mac shortcut in the file-pick tooltip

Evidence:

- Desktop and mobile DOM both showed `title="ファイルを選択 (⌘O)"`.
- Source: `src/components/Composer.tsx:83`

Impact:

- The current machine is Windows, so this is a false affordance.
- It is especially confusing because the global file shortcut was intentionally removed during reliability fixes.

Recommended fix:

- Either remove the shortcut text from the tooltip or show a platform-aware label.
- If the shortcut is not guaranteed globally, prefer `ファイルを選択`.

### P2: Pairing screen auto-focuses the manual code input

Evidence:

- On mobile viewport, after opening pairing, the active element was `#friend-code`.
- Source: `src/components/PairingScreen.tsx:178`

Impact:

- On mobile-like environments this can summon the keyboard immediately.
- It also pulls attention to manual code input even though the desired direction is "select the peer and connect" after the first pairing.

Recommended fix:

- Remove `autoFocus`.
- Focus should remain neutral, or move to the detected-device list only when there is a keyboard-accessibility reason to do so.

### P2: Several important mobile tap targets are below 32px height

Evidence from 390 x 844 viewport:

- `再接続`: 53 x 24.5
- `接続先を選ぶ`: 86 x 24.5
- Message cancel `取消`: 54 x 24
- Source:
  - `src/app/App.tsx:1533`
  - `src/app/App.tsx:1536`
  - `src/components/MessageBubble.tsx:177`

Impact:

- These are recovery actions used when connection or delivery fails.
- Small tap targets increase mistakes exactly when the user is already trying to recover from a bad state.

Recommended fix:

- Raise these to at least 32px visual height; 36-40px is better for connection recovery actions.
- Keep text compact, but increase padding/height.

### P2: Settings screen still exposes English option names

Evidence:

- Visible settings text included `Always on top`, `Launch at login`, `Notifications`, `Sound`.
- Source:
  - `src/components/SettingsScreen.tsx:163`
  - `src/components/SettingsScreen.tsx:170`
  - `src/components/SettingsScreen.tsx:177`
  - `src/components/SettingsScreen.tsx:184`

Impact:

- This is lower risk than pairing/transfer because settings are not the primary chat flow.
- Still, it makes the production app feel partially translated.

Recommended fix:

- Translate labels:
  - `Always on top` -> `常に前面に表示`
  - `Launch at login` -> `ログイン時に起動`
  - `Notifications` -> `通知`
  - `Sound` -> `サウンド`

### P3: Header/history/conversation fallback copy still contains English

Evidence:

- Header history button uses `aria-label="History"` and `title="History"`.
- Conversation selector fallback uses `No messages yet`.
- Source:
  - `src/components/Header.tsx:50`
  - `src/components/Header.tsx:51`
  - `src/components/Header.tsx:117`

Impact:

- The visible effect is small unless assistive tech or an empty preview fallback is used.
- It still counts as UI polish debt for production.

Recommended fix:

- `History` -> `履歴`
- `No messages yet` -> `まだメッセージはありません`

### P3: Conversation selector overlaps the disconnected diagnostic area

Evidence:

- On mobile viewport, opening the conversation selector placed the menu at y=93..184.
- The disconnected diagnostic actions behind it were at y=108..132.5.
- Both the selector menu and the diagnostic area contained `接続先を選ぶ`.

Impact:

- This is not a direct layout break because the overlay is intended.
- However, during connection trouble it creates visual duplication and makes the recovery path noisy.

Recommended fix:

- When the selector is open, dim/inert the diagnostic area, or move the selector into a modal/bottom-sheet style on narrow screens.
- Alternatively, hide the diagnostic action row while the selector is open.

## Prioritized Fix Order

1. Localize pairing, transfer, status, and shortcut labels.
2. Remove pairing input `autoFocus`.
3. Increase mobile tap targets for reconnect, choose peer, and cancel.
4. Replace security-heavy pairing copy with connection-first copy.
5. Clean up settings/header fallback English.
6. Revisit mobile conversation selector overlay after the above fixes.

## Verification Notes

- Console errors/warnings: none observed.
- Document-level horizontal overflow:
  - Chat desktop: none
  - Chat mobile: none
  - Pairing mobile: none
  - History mobile: none
  - Settings mobile after animation: none
- The current audit did not modify runtime behavior.
