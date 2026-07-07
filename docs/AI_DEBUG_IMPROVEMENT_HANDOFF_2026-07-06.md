# KunoChat AI Debug / Improvement Handoff Prompt

> **【2026-07-07 更新・最重要】実装担当AIへ: 本文書より新しい確定版の作業指示書が存在します。**
> **`docs/DEFECT_ELIMINATION_WORKORDER_2026-07-07.md` を最初に読み、その §2 の手順に従って作業してください。**
> その指示書には (1) 全80件バグチケットの現行コード検証結果(約半数はクローズ済み・再調査不要)、(2) 新規監査で発見した接続ライフサイクル/転送パイプラインの実在バグ、(3) 各修正の詳細設計(ファイル/行/コード/テスト名まで)、(4) ユーザー承認済みの決定事項(セキュリティ改修は対象外・診断機能と一括コミット・v0.7.0一括リリース)、(5) 検証・リリース手順の全てが含まれています。
> 本文書(以下)は背景資料として参照可。矛盾がある場合は WORKORDER が正です。

Date: 2026-07-06
Repository: `hira1001/KunoChat`
Target branch: `main`
Current released version: `v0.6.2`

## How To Use This Document

Give the prompt in the final section to another AI agent. The agent should use this repository directly, inspect the current code, reproduce the network problem as far as possible, implement fixes, test them, leave evidence, commit, push, and release if the fix affects installed users.

## Project Summary

KunoChat is a Windows/macOS desktop chat and file handoff app built with Tauri, React, TypeScript, and Rust.

Core runtime behavior:

- Embedded signaling WebSocket server: TCP `8787`
- LAN discovery: UDP `8788`
- Native encrypted file transfer: TCP `8790`
- Tailscale discovery: reads `tailscale status --json`, probes peer `8787`, and emits auto-connect candidates
- Fallback transfer path: WebRTC / realtime client

Important source files:

- `src/app/App.tsx`
- `src/features/realtime/realtimeClient.ts`
- `src/features/chat/chatStore.ts`
- `src-tauri/src/native/signal_server.rs`
- `src-tauri/src/native/peer_discovery.rs`
- `src-tauri/src/native/tailscale_discovery.rs`
- `src-tauri/src/native/transfer.rs`
- `src-tauri/tauri.conf.json`

Important evidence files:

- `docs/verification/2026-07-06-connection-regression-fix.md`
- `docs/verification/2026-07-06-network-debug-homedesktop.md`
- `docs/verification/2026-07-06-ux-backlog-audit.md`
- `docs/V0.6.0_HYBRID_DELIVERY_REQUIREMENTS.md`
- `docs/V0.6.0_HYBRID_DELIVERY_BASIC_DESIGN.md`
- `docs/V0.6.0_HYBRID_DELIVERY_DETAILED_DESIGN.md`

## Current Confirmed State

`v0.6.2` was released and installed on the local Windows machine.

Local device:

- Host: `XPS-Notebook`
- KunoChat version: `0.6.2`
- KunoChat path: `C:\Users\ymy26\AppData\Local\KunoChat\kunochat.exe`
- Wi-Fi IPv4: `192.168.64.79`
- Tailscale IPv4: `100.87.112.32`

Local KunoChat listener health:

- TCP `0.0.0.0:8787`: listening
- TCP `0.0.0.0:8790`: listening
- UDP `0.0.0.0:8788`: listening
- `127.0.0.1:8787`: reachable
- `127.0.0.1:8790`: reachable
- `192.168.64.79:8787`: reachable
- `192.168.64.79:8790`: reachable
- `100.87.112.32:8787`: reachable
- `100.87.112.32:8790`: reachable
- Local WebSocket probe to `ws://127.0.0.1:8787` returns `connection-request-ack`

Remote target currently causing connection failure:

- Host: `HomeDesktop`
- MagicDNS: `homedesktop.tailc8c15b.ts.net`
- Tailscale IPv4: `100.100.123.107`
- LAN IPv4 observed by Tailscale: `192.168.64.51`
- OS: Windows
- Tailscale status: online and active

Remote network facts:

- Tailscale ping to `HomeDesktop`: works
- TCP `100.100.123.107:22`: open
- TCP `homedesktop.tailc8c15b.ts.net:22`: open
- TCP `100.100.123.107:41475` Tailscale PeerAPI: open / HTTP 200
- TCP `100.100.123.107:8787`: timeout
- TCP `100.100.123.107:8790`: timeout
- TCP `192.168.64.51:8787`: timeout
- TCP `192.168.64.51:8790`: timeout

Current strongest diagnosis:

The local app and general Tailscale transport are healthy. The failure is isolated to the remote Windows peer `HomeDesktop`: KunoChat-specific inbound ports `8787` and `8790` are unreachable. Most likely causes are remote KunoChat not running, remote app not updated to `0.6.2`, remote listener bind failure, stale firewall rules, or inbound firewall/security software blocking the active `kunochat.exe`.

## Known Product / UX Requirements

The user wants KunoChat to behave closer to LINE:

- User should not need to press a connection button after the first pairing.
- Known peers should be selectable as separate chats.
- A known peer should be messageable even while offline.
- Messages should queue locally and send automatically when both sides become reachable.
- If both sides open the same chat, presence should become online automatically.
- UX should not show large duplicate banners for "auto-connect waiting" and "offline send" states.
- Reconnect and diagnostics should be obvious and low-friction.
- File/image previews must work.
- Minimized app should show notification badge/unread count behavior where feasible.
- App close button on Windows should fully exit, not hide.
- Security/perfect integrity is secondary because the app is used in a home environment; feature strength and reliability matter more.

## Suspected Improvement Areas

### 1. Remote Self-Check / Diagnostics UI

Add a clear "Network Diagnostics" view or command that shows:

- App version
- Process path
- Local IPs
- Tailscale status
- Whether TCP `8787` is listening
- Whether UDP `8788` is listening
- Whether TCP `8790` is listening
- Windows Firewall rule status for the active executable path
- Last auto-connect candidate and selected peer
- Last connection failure reason
- Copyable diagnostic report

The user should not need to run PowerShell manually for basic debugging.

### 2. Windows Firewall Auto-Repair

Investigate and implement a production-safe way to ensure Windows inbound rules for:

- TCP `8787`
- UDP `8788`
- TCP `8790`

Rules must point to the active installed executable:

`%LOCALAPPDATA%\KunoChat\kunochat.exe`

Possible strategies:

- On startup, detect missing/stale rules and show a one-click repair button.
- Use a Tauri command to run a repair script with elevation if needed.
- Add installer-level firewall rules if practical.
- At minimum, document and expose a copyable PowerShell repair command.

Expected repair command shape:

```powershell
$exe = Join-Path $env:LOCALAPPDATA 'KunoChat\kunochat.exe'
Get-NetFirewallRule -DisplayName 'KunoChat*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'KunoChat TCP 8787' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Program $exe -Profile Any
New-NetFirewallRule -DisplayName 'KunoChat TCP 8790' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Program $exe -Profile Any
New-NetFirewallRule -DisplayName 'KunoChat UDP 8788' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8788 -Program $exe -Profile Any
```

### 3. Peer Reachability Scoring

Detected peers should be shown with concrete reachability:

- LAN reachable
- Tailscale reachable
- Signaling port reachable
- Native transfer port reachable
- Last successful route
- Last failed route

If a peer is online in Tailscale but KunoChat ports are closed, the UI should say something like:

`HomeDesktop is reachable via Tailscale, but KunoChat is not listening on 8787. Start/update KunoChat or repair Firewall on HomeDesktop.`

### 4. Avoid Misleading Online States

Do not call a peer "online" only because Tailscale reports it online. KunoChat online should mean:

- Peer machine is reachable, and
- KunoChat signaling port is reachable, or
- A realtime session is actually connected

Use separate labels if needed:

- `Device online`
- `KunoChat available`
- `Chat connected`
- `Queued`

### 5. Better Offline Queue / Reconnect Worker

Known conversations should queue messages while offline. A background worker should:

- Retry known peer routes periodically
- Prefer last successful route
- Try Tailscale and LAN routes
- Avoid UI jumps while retrying
- Mark messages as queued, sending, sent, failed clearly
- Never block typing just because the peer is offline

### 6. Release Safety

If code changes are made:

- Update version if user-facing installed behavior changes.
- Run full tests.
- Add evidence in `docs/verification/`.
- Commit and push.
- If releasing, tag and confirm GitHub Release plus `latest.json`.

## Required Debug Commands

Run locally:

```powershell
git pull --ff-only
git status --short --branch
npm run typecheck
npm test -- --run
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check --locked
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --locked --lib
```

Network inspection on Windows:

```powershell
$exe = Join-Path $env:LOCALAPPDATA 'KunoChat\kunochat.exe'
(Get-Item $exe).VersionInfo | Select-Object FileVersion,ProductVersion,FileName
Get-Process kunochat -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path,StartTime
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8787,8790 } | Select-Object LocalAddress,LocalPort,State,OwningProcess
Get-NetUDPEndpoint | Where-Object { $_.LocalPort -eq 8788 } | Select-Object LocalAddress,LocalPort,OwningProcess
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*kunochat*' } | ForEach-Object { $rule = Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $_; [pscustomobject]@{DisplayName=$rule.DisplayName; Enabled=$rule.Enabled; Direction=$rule.Direction; Action=$rule.Action; Profile=$rule.Profile; Program=$_.Program} }
```

Tailscale inspection:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' status --json
& 'C:\Program Files\Tailscale\tailscale.exe' ping --timeout=5s --c=3 100.100.123.107
Test-NetConnection -ComputerName 100.100.123.107 -Port 8787 -InformationLevel Detailed
Test-NetConnection -ComputerName 100.100.123.107 -Port 8790 -InformationLevel Detailed
Test-NetConnection -ComputerName homedesktop.tailc8c15b.ts.net -Port 8787 -InformationLevel Detailed
```

## Repository Safety Rules

- Do not revert unrelated local changes.
- There may be unrelated untracked files and a tracked deleted Japanese design file in the worktree. Do not stage them unless explicitly asked.
- Prefer `rg` for searching.
- Use focused patches.
- Keep evidence docs short but concrete.
- If implementing code, add targeted tests for the exact failure mode.
- Always pull before work and push after finishing.

## Deliverables Expected From The Other AI

At minimum:

1. Root cause statement with evidence.
2. Patch or explicit reason why no patch is possible from this machine.
3. Tests and command outputs summarized.
4. New or updated evidence file under `docs/verification/`.
5. Commit and push.

If user-facing reliability is improved:

1. Version bump.
2. Release tag.
3. GitHub Release confirmation.
4. `latest.json` confirmation.

## Prompt To Give Another AI

```text
あなたは KunoChat リポジトリを引き継ぐデバッグ・改善担当AIです。

目的:
KunoChat の Windows/Mac デスクトップアプリについて、接続不能問題をネットワーク層から厳密に再調査し、必要な改善を実装・テスト・証跡化・コミット・push してください。ユーザーは家庭内利用を想定しており、セキュリティや完全性よりも、LINE のように「相手を選べば送れる」「接続ボタンを意識しない」「オフラインでも送信待ちできる」「復帰時に自動送信される」UXを重視しています。

現在の重要事実:
- 現行リリースは v0.6.2。
- ローカル Windows の KunoChat 0.6.2 は TCP 8787 / TCP 8790 / UDP 8788 を正常に待受しています。
- ローカル `ws://127.0.0.1:8787` は `connection-request-ack` を返します。
- 相手 `HomeDesktop` は Tailscale ではオンラインです。
- `HomeDesktop` の Tailscale IPv4 は `100.100.123.107`、MagicDNS は `homedesktop.tailc8c15b.ts.net`。
- `100.100.123.107:22` と Tailscale PeerAPI `100.100.123.107:41475` は開いています。
- しかし `100.100.123.107:8787` と `100.100.123.107:8790` は timeout。
- LAN 側 `192.168.64.51:8787` と `192.168.64.51:8790` も timeout。
- つまり Tailscale 全体ではなく、HomeDesktop 側の KunoChat ポートだけが閉じている可能性が高いです。
- 詳細証跡は `docs/verification/2026-07-06-network-debug-homedesktop.md` を必ず読んでください。

必ずやること:
1. `git pull --ff-only` から始める。
2. `docs/verification/2026-07-06-network-debug-homedesktop.md` と `docs/verification/2026-07-06-connection-regression-fix.md` を読む。
3. 現在の接続不能が HomeDesktop 側の起動・バージョン・listen・Firewall・古いexeパス問題なのか、追加で切り分ける。
4. アプリ内にユーザー向けネットワーク診断/修復導線を追加できるか検討し、可能なら実装する。
5. Windows Firewall の stale rule / missing rule を検出し、ユーザーが修復できる仕組みを入れる。
6. Tailscale がオンラインでも KunoChat の 8787 が閉じている場合、UIで「端末はオンラインだがKunoChatが待受していない」と明示する。
7. 既知チャットへのオフライン送信・自動再接続 UX を壊さない。
8. 変更したら `npm run typecheck`, `npm test -- --run`, `npm run build`, `cargo check --locked`, 必要な Rust tests を実行する。
9. `docs/verification/` に証跡を残す。
10. 意図したファイルだけを commit して push する。
11. インストール済みユーザーに必要な変更なら version bump, tag, release, latest.json 確認まで行う。

禁止:
- ユーザーの未追跡ファイルや無関係な削除差分を勝手に stage/revert しない。
- 「Tailscaleがオンライン」だけで「KunoChatが接続可能」と扱わない。
- 証跡なしに「修正済み」と言わない。
- UIを大きな警告バナーだらけにしない。診断は必要なときに見られる形にする。

望ましい改善:
- Network Diagnostics パネル
- Copy Diagnostic Report ボタン
- Windows Firewall rule status 表示
- One-click repair または copyable repair PowerShell
- Peer reachability scoring: LAN/Tailscale/signaling/native-transfer
- Last successful route 保存
- Offline queue and reconnect worker の安定化

最終回答では、原因、実装内容、検証結果、証跡ファイル、commit hash、push/release 状態を簡潔に報告してください。
```

## 進捗ログ (2026-07-06 セッション2、Claude Fable 5 → 引き継ぎ)

このセッションで本ハンドオフ文書に基づき実装を開始した。**まだコミット/push/リリースはしていない。** 作業はローカルの未コミット差分としてのみ存在する。次のAIは `git status` で以下の変更/新規ファイルを確認できる。

### 完了したこと

1. **Rust: ネットワーク診断コマンドを新規実装** — `src-tauri/src/commands/diagnostics.rs` (新規ファイル)
   - `collect_network_diagnostics` Tauriコマンド: アプリバージョン、exeパス、LAN IP、Tailscale IP、TCP 8787/UDP 8788/TCP 8790 の待受状態、Windowsファイアウォールルール状態、Tailscaleピア一覧(オンライン状態 + KunoChat 8787 到達性)を返す。
   - `probe_peer_ports` Tauriコマンド: 任意ホストに対してTCP 8787/8790の到達性をオンデマンドで確認(診断パネルの「相手の到達確認」用)。
   - `repair_firewall_rules` Tauriコマンド: Windowsのみ。古い/不足しているKunoChatファイアウォールルールを全削除し、現在実行中のexeパスに対して8787(TCP)/8790(TCP)/8788(UDP)のInbound Allowルールを`Start-Process -Verb RunAs`で管理者権限昇格の上、再作成する。
   - `firewall_repair_script()` は同じ修復スクリプトを文字列として返す関数で、UI側の「修復コマンドをコピー」ボタンと処理を共有(ロジック二重化を回避)。
   - ファイアウォール状態は `ok` / `blocked` / `stale` / `missing` / `unknown` の5値に分類 (`classify_firewall_rules`)。単体テスト13件で分類ロジック・PowerShell JSON parse・スクリプト生成をカバー。
   - `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` にモジュール登録・invoke_handler登録済み。
   - `cargo check --locked` / `cargo test --locked --lib` は69件全てPASS(このセッション時点)。

2. **Rust: 「Tailscaleオンラインだが KunoChat 未応答」を誠実に区別** —
   - `src-tauri/src/native/tailscale_discovery.rs`: `AutoConnectPayload` に `reachable: bool` フィールドを追加。Tailscaleピアがオンラインでも8787に接続できない場合は `reachable: false` で `kuno:auto-connect` イベントを発火するように変更(以前は到達不可なら黙って候補から除外していた)。到達不可の場合の再emit間隔を`UNREACHABLE_REEMIT_AFTER=15秒`に設定(到達可能時は5秒)。dedupeロジックを単一スロットからHashMapベースの複数候補追跡に変更(`should_emit_candidate`のシグネチャ変更、関連テスト更新済み)。
   - `src-tauri/src/native/peer_discovery.rs`: LAN UDP探索でも同様に、ピアがUDPで応答していてもTCP 8787に接続できない場合は `reachable: false` を付与するよう変更。到達性はホストごとに3秒キャッシュ(`probe_signaling_cached`)し、毎tick TCP connectしないようにした。
   - 両ファイルのRustユニットテストを更新・追加済み(cargo testでPASS確認済み)。

3. **フロントエンド: 診断サービス層** — `src/features/diagnostics/diagnosticsService.ts` (新規ファイル) + `diagnosticsService.test.ts` (新規、13件PASS)
   - `collectNetworkDiagnostics()`, `probePeerPorts()`, `repairFirewallRules()` — 上記Tauriコマンドの薄いラッパー。
   - `buildDiagnosticReport()` — コピー可能なテキスト診断レポートを生成する純粋関数(ユニットテスト済み)。
   - `firewallStatusLabel()`, `firewallNeedsRepair()` — ファイアウォール状態のUI表示用ヘルパー。
   - `firewallRepairCommand(exePath)` — 手動修復用のコピー可能PowerShellコマンド文字列を生成(Rust側スクリプトと同内容、UIから直接コピーする用)。
   - `peerReachabilitySummary(peer)` — 「端末はオンラインだがKunoChatは応答していない」を明示するラベル+ガイダンス文を返す(ハンドオフ文書が要求していた文言のUI版)。

4. **フロントエンド: Network Diagnostics パネルUI** — `src/components/DiagnosticsPanel.tsx` (新規ファイル)
   - 自分のPC情報(バージョン、exeパス、LAN/Tailscale IP、3ポートの待受状態)。
   - Windowsファイアウォール状態表示 + 「ワンクリック修復(管理者権限)」ボタン + 「修復コマンドをコピー」ボタン。
   - Tailscaleピア一覧(オンライン/オフライン + KunoChat応答有無を別バッジで表示)。
   - 任意ホストへの到達確認欄(IP入力→確認ボタン→8787/8790到達性表示)。
   - 接続状況(最後の接続候補、最後の接続失敗理由と時刻)。
   - 「レポートをコピー」ボタンで `buildDiagnosticReport()` の出力をクリップボードにコピー。
   - `SettingsScreen.tsx` に「接続」パネルを新設し、「ネットワーク診断」への導線ボタンを追加(`onOpenDiagnostics` prop)。
   - `App.tsx` に `AppView = "diagnostics"` ケースを追加し、遷移・`connectionContext`(lastAutoConnect / lastConnectionFailure)受け渡しを実装。

5. **フロントエンド: 誠実なオンライン状態表示(banner + pairing一覧)**
   - `App.tsx`: `lastConnectionFailure` state を追加し、接続失敗系のあらゆる箇所(`onError`, タイムアウト, `reconnectConversation`のcatch, `handleConnectDetectedPeer`のcatch)で記録するようにした。診断パネルの「最後の接続失敗」に表示される。
   - `App.tsx`: アクティブな会話の相手が検出済みピアの中に `reachable: false` として存在する場合、"相手のKunoChatが応答していません"という専用バナー(sticky、自動待機バナーに丸め込まれない)を表示するロジックを追加(`activePeerAppDown` / `activePeerAppDownDiagnostic`)。バナーに「診断」ボタンを追加し、ワンタップで診断パネルに飛べるようにした。
   - `PairingScreen.tsx`: 検出済みピア一覧で `reachable: false` のピアを警告色(amber)で表示し、「応答なし」ラベルと理由tooltipを表示。到達可能なピアを先に並べ、応答なしピアは下に表示するソートを追加(`sortPeersByReachability`)。
   - `handleConnect()`: 自動選択されるピアを「到達可能なピアを優先」するように変更(`detectedPeers.find(p => p.reachable !== false) ?? detectedPeers[0]`)。

6. **バックグラウンド再接続ワーカーの強化**
   - `App.tsx` に20秒間隔の `setInterval` を追加し、メイン/ミニウィンドウ表示中で `connectionStatus` が `offline`/`failed`/`pairing` のとき `ensureActiveConversationConnection("resume")` を定期的に呼び出すようにした(以前はフォーカス/visibilitychange/onlineイベント頼みで、バックグラウンド放置時は再試行されなかった)。

7. **型定義更新**
   - `src/features/chat/messageTypes.ts`: `AppView` に `"diagnostics"` を追加。`ConversationSummary` に `lastConnectedAt?: number` を追加(接続成功時刻の記録用、`chatStore.ts`の`setConnectionStatus`で書き込み)。

8. **テスト状況(このセッションの最終確認時点)**
   - `npm run typecheck` → **PASS**
   - `npm test -- --run` → **209件 PASS**(既存196件 + 新規診断サービステスト13件)
   - `cargo check --locked` → **PASS**
   - `cargo test --locked --lib` → **69件 PASS**
   - `npm run build` は実行中にユーザーの割り込みでキャンセルされた。**次のAIは必ず `npm run build` を再実行して確認すること。**

### まだやっていないこと / 次のAIがやるべきこと

1. **`npm run build` の再確認**(本セッションで中断された)。
2. **`docs/verification/` に新しい証跡ファイルを追加**(例: `2026-07-06-network-diagnostics-and-honest-presence.md`)。以下を記載:
   - 実装した機能一覧と該当ファイル
   - `npm run typecheck` / `npm test -- --run` / `npm run build` / `cargo check --locked` / `cargo test --locked --lib` の実行結果
   - 可能であればWindows実機での動作確認(診断パネルを開く、ファイアウォール状態表示、修復ボタン押下、ピア一覧の応答なし表示)
   - `HomeDesktop` 側の根本原因は依然としてリモート側でしか確認できない(このマシンからはリモートに管理者アクセスできない)。今回の実装は「原因を直せる」機能ではなく「原因をユーザー自身が診断・修復できる」機能である点を明記すること。
3. **バージョン管理**:
   - 現在 `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` はいずれも `0.6.2` のまま。ユーザー向け機能追加(診断パネル、ファイアウォール修復、誠実なオンライン表示)なので **v0.6.3 へのバージョンアップが必要**。3ファイル(`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`)のバージョンを揃えて更新すること。
   - `scripts/release-preflight.mjs` があるので、リリース前に `npm run release:preflight`(または signed 版)を実行して要件を満たしているか確認すること。
4. **コミット/push/リリース**:
   - このセッションでは一切コミットしていない。`git status` に表示される意図しない他ファイル(`bug_tickets.md`, `debug_and_test_report.md`, `detailed_causal_debug_report.md`, `docs/KunoChat_AI_Functional_Test_Report_2026-07-05_bundle/`, 削除された `最高の設計書.md`, 新規 `設計書.md`)は**このタスクと無関係なユーザーの作業物なので、絶対にstage/commit/revertしないこと**。今回の変更に関連するファイルだけを `git add` すること。関連ファイル一覧:
     ```
     src-tauri/src/commands/mod.rs
     src-tauri/src/commands/diagnostics.rs (新規)
     src-tauri/src/lib.rs
     src-tauri/src/native/peer_discovery.rs
     src-tauri/src/native/tailscale_discovery.rs
     src/app/App.tsx
     src/components/DiagnosticsPanel.tsx (新規)
     src/components/PairingScreen.tsx
     src/components/SettingsScreen.tsx
     src/features/chat/chatStore.ts
     src/features/chat/messageTypes.ts
     src/features/diagnostics/diagnosticsService.ts (新規)
     src/features/diagnostics/diagnosticsService.test.ts (新規)
     ```
     バージョンアップする場合は `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` も追加。
   - コミット後 `git push`。リリースする場合はタグ付け、GitHub Release作成、`latest.json` の更新確認まで行うこと。
5. **未実装・要検討の項目**(ハンドオフ文書の「望ましい改善」より):
   - Peer reachability scoring は signaling(8787)のみ実装済み。native-transfer(8790)の到達性はTailscaleレポート内では未収集(`probe_peer_ports`ではオンデマンドで両方確認できるが、自動検出候補一覧には8790の結果を載せていない)。必要なら`TailscalePeerInfo`/`AutoConnectPayload`に`transferReachable`も追加を検討。
   - 「Last successful route」の永続化(`lastConnectedAt`をConversationSummaryに追加したのみで、どのroute/signalingUrlで繋がったかまでは保存していない)。再接続時に前回成功したsignaling URLを優先する処理は未実装。
   - Windows Firewall のインストーラーレベルでのルール追加(NSIS/WiX)は未着手。現状はアプリ起動後にユーザーが手動で診断パネルを開いて修復する方式のみ。
   - macOS/Linuxではファイアウォール診断は `supported: false` を返すのみで、実際の代替手段(pf/ufw等)は未実装。
   - 実機(Windows二台)での動作確認はこのセッションでは実施していない。特に「ワンクリック修復」のUAC昇格フロー、ファイアウォールルール分類のWindows実機での実際のPowerShell出力形式は机上のテストのみで検証されている。

### 次のAIへの申し送り事項

- 前回のセッションの `docs/verification/2026-07-06-network-debug-homedesktop.md` に書かれた `HomeDesktop` 側の根本原因(リモートの8787/8790が閉じている)は、このセッションの実装だけでは直接解決されない。ユーザーが `HomeDesktop` 側で診断パネルを開くか、修復コマンドを実行する必要がある。
- 実装は「診断と自己修復をユーザーに提供する」フェーズであり、「HomeDesktopの根本原因を修正した」わけではない。最終回答でこの区別を明確にすること。
- `git pull --ff-only` を必ず最初に行うこと(このセッション開始時点でも `origin/main` と同期済みだったが、他セッションが並行して動いている可能性がある)。

### 【重要・確定情報】HomeDesktop接続不能の根本原因(ユーザー確認済み)

ユーザー本人から明確な確認が入った: **`HomeDesktop` 側は単純にKunoChatアプリを起動していなかっただけ。** ファイアウォール、stale rule、古いexeパス、バージョン不一致といった複雑な原因ではない。

これにより:

- 前回セッションおよび本セッションで積み上げた「ファイアウォール/バインド失敗/stale rule」仮説は、**今回の具体的な接続不能事象の直接原因ではなかった**と判明した。ネットワーク層(Tailscale、LAN、ポート到達性)自体は元々正常だった。
- ただし、今回実装した「Network Diagnosticsパネル」「Tailscaleオンラインだが KunoChat未応答」の誠実な表示、ファイアウォール状態確認/修復機能は、**この種の「相手がアプリを起動し忘れている」ケースをユーザー自身が即座に見分けられるようにする**という点で、引き続き価値がある改善である。むしろ「ファイアウォールではなくアプリが起動していないだけ」と一目で分かるようにすることが本来のゴールだったとも言える(誤診断コストの削減)。
- 次のAIは、この情報を踏まえて以下を確認・調整すること:
  1. 診断パネルやピア一覧の文言が「ファイアウォールを疑わせすぎる」表現になっていないか再確認する。現在の実装では `peerReachabilitySummary()` が「KunoChatを起動・更新するか、ファイアウォールを修復してください」という順序でガイダンスを出しており、**アプリ起動確認を先に案内する文言は既に妥当**だが、ファイアウォール修復ボタンを目立たせすぎて「まずファイアウォールが原因」と誤解させない配置になっているか、UIレビュー時に注意すること。
  2. `docs/verification/` に証跡を書く際は、「HomeDesktopのポート不通は、リモートでKunoChatが起動していなかったことが確定原因であり、ファイアウォール/バインド不良ではなかった」と明記すること。前回書かれた「最も可能性の高い原因」リストの中の「1. KunoChatが起動していない」が正解だったと明示する。
  3. ファイアウォール自動修復機能自体は無駄ではない(将来的に本当にファイアウォールが原因のケースはありうる)ため、実装を取り下げる必要はない。ただし「これさえあれば直る」という過大な位置づけをコミットメッセージやリリースノートでしないこと。
