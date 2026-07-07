# KunoChat 欠陥根絶計画 — 実装AI向け完全作業指示書

作成日: 2026-07-07 / 作成: 計画セッション(Claude) / 対象リポジトリ: `C:\Users\ymy26\Documents\KunoChat` (main)

## 1. コンテキスト(なぜこの作業をするか)

- KunoChat は Tauri + React/TS + Rust の家庭内 1:1 チャット/ファイル転送アプリ(LAN + Tailscale)。
- ユーザーの要望は**機能追加ではなく欠陥除去**。「LINEのように、相手を選べば送れて、接続ボタンを意識せず、オフラインでも送信待ちでき、復帰時に自動送信される」体験を壊す不具合をなくす。
- ユーザーが実際に頻繁に遭遇している症状(本人確認済み): **(a) 接続がつながらない/切れる、(b) 表示/UIがおかしい**。この2系統の修正が最優先。
- リポジトリ直下の `bug_tickets.md`(80件) は**古い監査リスト**。本計画セッションで全80件を現行コードと突き合わせ検証済み → 約半数は既に修正済み/誤検出。本書の台帳(§4)が最新の正であり、bug_tickets.md を再検証する必要はない。
- さらに現行コードへの新規監査を実施し、接続ライフサイクル(C-1〜C-7)と転送パイプライン(T-1〜T-11)の実在バグを特定済み(§5, §6)。

### ユーザー決定事項(2026-07-07 確認済み・変更不可)

1. **セキュリティ系の改修は全て対象外**(ハンドシェイク暗号化 BUG-070、シグナリング参加認証 BUG-034、署名ドメイン分離 BUG-036、信頼鍵SQLite移行 BUG-051、fs_scope縮小 BUG-071、接続自動承認の廃止 BUG-012 など)。家庭内利用でセキュリティは二の次、信頼性優先。
2. **未コミットのネットワーク診断機能(前セッション実装済み・テスト済み)はバグ修正と一緒にコミット**する。
3. **一括リリース**(段階リリースしない)。全修正を1バージョンにまとめる。

### 前提: 作業ツリーの現状(未コミット差分あり)

作業開始時点で以下の**未コミット変更が存在する。これは前セッションの成果物であり、絶対に破棄・revertしないこと**。この上に修正を積む。

- 変更済み: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/native/peer_discovery.rs`, `src-tauri/src/native/tailscale_discovery.rs`, `src/app/App.tsx`, `src/components/PairingScreen.tsx`, `src/components/SettingsScreen.tsx`, `src/features/chat/chatStore.ts`, `src/features/chat/messageTypes.ts`
- 新規: `src-tauri/src/commands/diagnostics.rs`, `src/components/DiagnosticsPanel.tsx`, `src/features/diagnostics/diagnosticsService.ts`, `src/features/diagnostics/diagnosticsService.test.ts`
- 内容: ネットワーク診断パネル、FW修復、ピア到達性表示(`reachable`フラグ)、20秒間隔バックグラウンド再接続、`lastConnectedAt`。詳細は `docs/AI_DEBUG_IMPROVEMENT_HANDOFF_2026-07-06.md` の「進捗ログ」参照。
- ベースライン(検証済み): `npm run typecheck` PASS / `npm test -- --run` 209件PASS / `cargo check --locked` PASS / `cargo test --locked --lib` 69件PASS。`npm run build` のみ未実行(中断された)ので最初に実行して確認すること。

### コミット対象外のファイル(ユーザー私物 — 絶対に stage/commit/revert しない)

`bug_tickets.md`, `debug_and_test_report.md`, `detailed_causal_debug_report.md`, `docs/KunoChat_AI_Functional_Test_Report_2026-07-05_bundle/`, 削除済み `最高の設計書.md`, 未追跡 `設計書.md`。`git add -A` は禁止。ファイルを明示指定して add すること。

---

## 2. 作業全体の流れ(この順で実施)

1. **Step 0 — ベースライン確認**: `git pull --ff-only` → `npm run build`(未確認のため) → 4種テストコマンド再実行。全部グリーンであることを確認してから着手。
2. **Batch A — 接続ライフサイクル修正**(§5)。ユーザー最優先症状。
3. **Batch B — UI/状態整合性修正**(§6)。
4. **Batch C — リソースリーク/転送信頼性修正**(§7)。
5. **Batch D — 起動/OS互換の小修正**(§8)。
6. 各Batch完了ごとに: `npm run typecheck && npm test -- --run && cd src-tauri && cargo check --locked && cargo test --locked --lib`。グリーンを維持したまま次へ。
7. **最終検証・証跡・リリース**(§9): build、証跡ドキュメント、バージョン 0.6.2→**0.7.0**、コミット、push、タグ、GitHub Release、latest.json 確認。

実装順の原則: 同一ファイルを触る修正は同じBatch内でまとめて行い、コンフリクトを避ける。各修正には対応するテストを**同時に**追加する(後回しにしない)。

---

## 3. 全80件チケットの検証結果サマリ(再調査不要・確定)

### 修正済み/誤検出として**クローズ**(実装作業なし)

BUG-002(60秒バックオフ実装済), 004(ファイルフォールバック実装済), 005(sync_all は完了時のみ), 006(addEventListener使用), 008(revoke実装済・軽微な残りは§7), 010(意図された定数差), 011(将来用), 014(failedメッセージ+再試行ボタンで復元可), 015(プロセス終了で解放・実害なし), 016(sanitize完備・テスト有), 017(グローバルAtomicU64ノンスで一意), 019(MAX_FRAME_BYTESチェック有), 020(unique_save_pathで回避), 021(symlink/reparse point スキップ済), 023(isComposingガード有), 024(isDir判定→zip経路有), 025(dbQueueで直列化済), 026(メモリ+SQLite両方クリア済), 027(タイマー全クリア済), 028(旧ハンドラクリア済), 030(acceptエラーはループ脱出・スピンしない), 033(unlistenクリーンアップ正常), 035(意図した設計), 037(100ms sleep有), 040(.arg()で安全), 041(Ctrl+Shift+Spaceのみ登録), 043(oncloseで再接続スケジュール済), 046(onClick実装済), 047(sendDraftInFlightガード有), 049(maxLength=32有・ReactがXSS防止), 050(ping/pong 10s/30s実装済), 053(socket.close()有), 057(try-catch有), 060(プロセス終了で解放), 062(スクロール可能・全件表示), 063(30MBキャップ+ネイティブフォールバック), 064(convertFileSrc優先済), 065(全closeパスでstatus通知), 066(setDiagnostic有), 069(再接続時に新名送信・実害なし), 073(readyStateガード有), 074(MAX 12回で打ち切り), 076(window.confirm有), 077(clearTransfersHistory呼出済), 079(同期初期化・発生不能), 080(online/focus/visibility+20s interval全て有)

### ユーザー決定によりスコープ外(セキュリティ/設計判断)

BUG-012(自動承認は意図したUX), 034, 036, 051, 070, 071, 072(自動承認下で拒否は実質使われない)

### 対象外(ブラウザ専用モードの問題・デスクトップ利用に影響なし)

BUG-048(ブラウザDnDフォルダ判定 — Tauriではネイティブ経路が優先され問題なし), T-5(ブラウザでの再起動後resume)

### 延期(P3 — 今回は実装しない。理由も記載)

- BUG-001/018/078(マルチNIC探索): 修正はネットワークインターフェース列挙が必要で大掛かり(`if-addrs`クレート追加等)。ユーザー環境(単一Wi-Fi+Tailscale)では現状動作しており、費用対効果が低い。
- BUG-045(受信前ディスク空き容量チェック): Rust stdに空き容量APIがなくクレート追加(`sysinfo`等)が必要。家庭内利用では稀。
- BUG-056(IPC JSON配列シリアライズの性能): 機能は正しく動作。性能改修はリスクの割に体感差が限定的(ネイティブTCP転送が主経路のため)。
- BUG-067(添付時サムネイル生成): UX向上でありバグではない。

### 実装対象(確定バグ) → §5〜§8 に修正設計を記載

接続系: C-1, C-2, C-3+C-7, C-4, C-5, BUG-031, BUG-058, BUG-059, BUG-061
UI/状態系: T-1+T-11, T-6, T-7, BUG-013, BUG-052, BUG-054, BUG-032, BUG-055, BUG-075
リーク/転送系: T-2, T-3, T-4+T-9, T-8+BUG-003, T-10, BUG-007+009, BUG-008残り, BUG-022, BUG-029, BUG-038, BUG-042, BUG-044, BUG-068

---

---

## 5. Batch A — 接続ライフサイクル修正(ユーザー症状「つながらない/切れる」対応)

> 設計済み仕様。行番号は現行HEAD基準。実装順は §5.9 の通り。
> **設計時の重要発見**: (1) `realtimeClient.ts:1370` の `beginIdentityHandshake()` は**現在どこからも呼ばれていないデッドコード**であり、そのため `acceptOpenControlChannel()` が `verified=true` を偽装している。(2) `signal_server.rs` の `handle_connection` は読み取りエラー時(line 118 の `?`)に `leave_room` クリーンアップ(line 276)を**スキップして早期リターン**しており、部屋スロットをリークする(「room already has two peers」エラーの主因候補)。

### 5.0 共通基盤(最初に実施)

**G-1. 新規モジュール `src/features/realtime/pairing.ts`**

```ts
// Rust側 room_id_for_pair (peer_discovery.rs:211, FNV-1a 32bit) のTS移植。
// peer id は /^[A-Za-z0-9_-]{1,128}$/ のASCIIのみなので JS の `<=` と Rust のバイト比較は一致する。
export function roomIdForPair(left: string, right: string): string {
  const [first, second] = left <= right ? [left, right] : [right, left];
  let hash = 2166136261 >>> 0;
  for (const byte of new TextEncoder().encode(first + second)) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String(hash % 1_000_000).padStart(6, "0");
}
// discovery と同じ規則: 辞書順で小さいIDがhost (peer_discovery.rs:100-105 は小さいIPをhostにしている)
export function roleForPair(localId: string, remoteId: string): "host" | "join" {
  return localId < remoteId ? "host" : "join";
}
```

クロス言語フィクスチャ(Rust側テストにも同じリテラルを追加して言語間ドリフトを検出): `roomIdForPair("left","right") === "943954"`, `roomIdForPair("peer_a","peer_b") === "345804"`。※実装AIは最初にRust側 `room_id_for_pair("left","right")` を実際に実行して "943954" を確認し、違えばTS側フィクスチャをRustの実出力に合わせること(正はRust)。

**G-2. chatStore: 安定ピアIDの保存**

- `messageTypes.ts:104` `ConversationSummary` に `stablePeerId?: string;` を追加(相手の永続 `settings.localPeerId`)。**既存 `peerId` は流用しない**(requester側では `peerId` がIPで `conversationIdForPeer`(chatStore.ts:1632)に使われており、上書きすると会話IDが分岐する)。
- 新アクション `setConversationStablePeerId(conversationId, stablePeerId)` を追加(該当会話にフィールドをupsertするだけ)。persist の partialize は `conversations` を丸ごと含むため追加作業不要(要確認)。

### 5.1 C-3+C-7: identity検証完了まで "connected" を出さない

対象: `src/features/realtime/realtimeClient.ts`

1. 新定数 `IDENTITY_HANDSHAKE_TIMEOUT_MS = 10_000`(~line 48)、新フィールド `private identityTimeoutTimer?: number;`(~line 186)。
2. **`acceptOpenControlChannel()`(line 1458)を書き換え** — `verified` セットと `onStatus("connected")` を削除:
```ts
private acceptOpenControlChannel() {
  const identity = this.identity ?? { verified: false };
  this.identity = identity;
  if (identity.verified) {
    return; // local-browser transport は acceptLocalPeer で検証済み
  }
  const channel = this.control;
  if (!channel) return;
  this.startIdentityTimeout();
  void this.beginIdentityHandshake(channel); // ← デッドコード(line 1370)をここで結線する
}
```
   status は "connecting" のまま(`attachControlChannel` の `handleOpen`(line 1150)が直前に `onStatus("connecting")` を出す — この行は変更しない)。`startHeartbeat()`/`reannouncePendingAssets()` はここから削除(`acceptIdentityHello` lines 1454-1455 で既に実行される)。
3. 新メソッド `startIdentityTimeout()` / `clearIdentityTimeout()`: 10秒以内に検証完了しなければ `onStatus("failed")` + `onError("相手の本人確認が完了しませんでした。相手のKunoChatを最新版にして、もう一度接続してください。")` + `closeTransport()`。**`manualDisconnect` はセットしない**(バックグラウンド再接続が新しい `connect()` でリトライできるように)。
4. `acceptIdentityHello`(line 1440): early-returnガードの直後に `this.clearIdentityTimeout();` を追加。`identity.verified = true`(1446)→ `onStatus("connected")`(1453)の順序は既存のままで、connected→flush→sendText→ensureAuthenticated が成立する。`isReady()`(292)と `ensureAuthenticated`(1482)は変更不要。
5. `closeTransport()`(line 246)に `clearIdentityTimeout()` を追加。
6. **identity-hello に安定ピアIDを載せる(C-1の材料)**:
   - `realtimeTypes.ts:64` identity-hello 型に `stablePeerId?: string` 追加(旧v0.6.2は未知フィールドを無視するので後方互換)。
   - `RealtimeConnectOptions` に `stableLocalPeerId?: string;` 追加。App.tsx の**全** `realtimeClient.connect` 呼び出しに `stableLocalPeerId: useChatStore.getState().settings.localPeerId` を渡す。
   - `beginIdentityHandshake`(line 1387 の sendControl)に `stablePeerId: options.stableLocalPeerId` を追加。
   - `handleIdentityHello`(line 1399)で純関数 `parseStablePeerId(value)`(`/^[A-Za-z0-9_-]{1,128}$/` 検証、exportしてテスト)により検証し `identity.remote.stablePeerId` に保存。`acceptIdentityHello` で `onIdentity` ペイロードに含める。`RealtimeCallbacks.onIdentity`(realtimeTypes.ts:78)に `stablePeerId?: string` 追加。

### 5.2 C-1: roomId/役割の決定論的収束

対象: `App.tsx`, `signal_server.rs`, `pairing.ts`

**プロトコル規則(v2)**: ペア部屋 = `roomIdForPair(自分の安定ID, 相手の安定ID)`。hostは辞書順で小さい安定ID側。部屋はhost側の内蔵シグナルサーバに置く(hostは `runtimeConfig.signalingUrl`=127.0.0.1、joinerは `ws://<hostIP>:8787` に接続)。v2は (a) 相手の `stablePeerId` を知っており、かつ (b) 相手のackが `proto >= 2` のときだけ使用。

1. **signal_server.rs**: line 185 のackに `"proto": 2` を追加。connection-request パース(138-187)で optional `requesterRole`("host"/"join"のみ許可)を読み、emit するイベントペイロードに含める。
2. **App.tsx `sendConnectionRequest`(line 1718)**: payload に `requesterRole?: "host"|"join"` を追加、戻り値を `Promise<{ proto: number }>` に変更(ackの `proto` を返す。無ければ1)。`ConnectionRequestPayload` 型(line 98)に `requesterRole?: "host"|"join"|null` 追加。
3. **接続4経路の変更**:
   - **(a) `reconnectConversation`(line 1109)**: `conversation.stablePeerId` が有れば `roomId = roomIdForPair(local, remote)`, `myRole = roleForPair(...)`、無ければ従来の `createPairingCode()` + join。connection-request は常に相手のサーバ(既存 signalingUrl)へ送り、`requesterRole` を含める。ack後 `mode = deterministic && ack.proto>=2 ? myRole : "join"`。connect の signalingUrl は `mode==="host" ? runtimeConfig.signalingUrl : 相手のURL`。`setLastAutoConnect` を最終値で更新。
   - **(b) `handleConnectDetectedPeer`(line 972)**: line 978 の `createPairingCode()` をやめ **常に `peer.roomId` を使う**(discoveryは両側で対称に `room_id_for_pair` と mode を計算済み)。`requesterRole: peer.mode` を送り、ack後 `mode = ack.proto>=2 ? peer.mode : "join"`、signalingUrl も mode に応じて切替。
   - **(c) `autoAcceptConnectionRequest`(line 1168)**: 冒頭に**グレア(相互同時発信)ガード**を追加 — 現在 connecting/reconnecting/connected で、かつ現在の部屋(`lastAutoConnect.roomId` 正規化)と `request.roomId` 正規化が一致するなら return。※ `lastAutoConnect` は once-registered listen コールバック内では stale になるため **`lastAutoConnectRef`(useRefでuseEffect同期)を新設して参照**(既存の潜在バグ修正を兼ねる)。役割は `request.requesterRole === "host" ? "join" : request.requesterRole === "join" ? "host" : "host"(旧形式)`。`activateConversation` 後に `setConversationStablePeerId(activeId, request.requesterPeerId)`。
   - **(d) `handleConnect`(6桁コード手入力, line 910)**: 意味は不変(相手のホスト部屋にjoin)。`stableLocalPeerId` を渡すのみ。pairing-hostエフェクト(line 522)と `handleRetryAutoConnect`(1068)も同様。
4. **requester側の安定ID学習**: `onIdentity` ハンドラ(App.tsx line 356)で `identity.stablePeerId` があれば `setConversationStablePeerId(boundConversationIdRef.current ?? activeId, identity.stablePeerId)`(boundConversationIdRef は §5.5)。
5. **後方互換マトリクス**: 旧→新(requesterRole無し→acceptorが旧式host)✓ / 新→旧(proto無し→requesterがjoinにフォールバック)✓ / 新→新初回(stablePeerId未学習→旧式1回→identity-helloで学習し次回から決定論)✓ / 新→新グレア(同一決定論部屋+相補役割+重複受理はガードで抑止)✓

### 5.3 C-2: 接続試行のsingle-flightガード

新規 `src/features/chat/connectGuard.ts`:
```ts
export function createConnectGuard(minSpacingMs = 8_000) {
  let inFlight: string | undefined;
  const lastAttemptAt = new Map<string, number>();
  return {
    begin(conversationId: string, { force = false, now = Date.now() } = {}) {
      if (inFlight !== undefined) return false;              // single-flight: force でも絶対に迂回不可
      if (!force && now - (lastAttemptAt.get(conversationId) ?? 0) < minSpacingMs) return false;
      inFlight = conversationId;
      lastAttemptAt.set(conversationId, now);
      return true;
    },
    end(conversationId: string) { if (inFlight === conversationId) inFlight = undefined; }
  };
}
```
App.tsx: `autoConnectInFlightRef` + `autoConnectAttemptAtRef`(167-168)を `connectGuardRef = useRef(createConnectGuard())` に置換。`ensureActiveConversationConnection`(814)の 825-838 を guard.begin/end 方式に書換。`handleRetryAutoConnect`(1068)も guard 経由(`force:true`)にする。全入口(view effect 294 / 20s interval 303 / recoverConnection 269 / handleSelectConversation 1105 / kickActiveConversationDelivery 1309)が自動的にガードを通る。

### 5.4 C-4: シグナルサーバ error 受信時の完全teardown

`realtimeClient.ts` `handleSignal`(line 987)の error 分岐を: `clearReconnectTimer()` → `closeTransport()`(ハンドラをnullにしてから閉じるので onclose が再接続をスケジュールできない)→ `onStatus("failed")` → `onError(text)` → return。`scheduleReconnect()` は呼ばない(満室部屋への再接続は無意味。回復はApp側バックグラウンドワーカーが新しい部屋で行う)。

### 5.5 C-5: flushを「その接続が属する会話」に限定

- 新ref `boundConversationIdRef`。全 `realtimeClient.connect` 呼び出しをラッパー `connectRealtime(conversationId, options)` 経由にし、接続開始時に bind。
- `flushPendingConnectionMessages`(1318)のフィルタ最終節を `=== (boundConversationIdRef.current ?? state.activeConversationId)` に変更。冒頭に `if (!realtimeClient.isReady()) return;` を追加。
- **「全会話をflush」は絶対にしない**(会話Bのメッセージが接続中のピアAに誤配送される)。
- ついで修正: `onIdentity`(370)の `setConversationTrustedPeer` も `boundConversationIdRef.current ?? activeId` に。
- 会話切替中の安全性は検証済み(`handleSelectConversation` 1099-1102 が disconnect するため旧bindの connected は発火しない)。
- 既知の残課題(今回対象外・証跡に記載): `resumeRecoveredTransfers`(863)は bound会話を確認せず再開する。

### 5.6 BUG-031: signal_server のping/死活刈り取り + クリーンアップ漏れ修正

`signal_server.rs`:
- 新定数 `SIGNAL_PING_INTERVAL=30s`, `SIGNAL_IDLE_TIMEOUT=75s`。
- `handle_connection` の読み取りループ(106-274)を `tokio::select!` 化: 30秒ごとに `Message::Ping` を try_send し、`last_activity` が75秒超過なら `break Err("signaling connection idle timeout")`。フレーム受信のたび(is_textフィルタ前、Pongも含む)に `last_activity = Instant::now()`。
- **ループ内の全ての早期 `return Err` / `?`(line 116 rate-limit, line 118 read error 等)を `break Err(e)` に変換**し、ループ後に既存のクリーンアップ(`leave_room` + peer-left broadcast + `writer.abort()`)を**無条件に実行**する。これが「room already has two peers」系の幽霊スロットの主修正。
- テスト容易化のため `fn should_reap(last_activity: Instant, now: Instant) -> bool` を抽出。
- `Message::Ping(Vec::new().into())` は tokio-tungstenite 0.26 の型(Bytes)に合わせて `.into()` で吸収(コンパイルで確認)。

### 5.7 Batch A のテスト一覧(実装と同時に追加)

- 新規 `src/features/realtime/pairing.test.ts`: `deterministic_room_id_matches_for_both_orders` / `deterministic_room_id_is_six_digit_zero_padded` / `deterministic_room_id_matches_rust_fixture`("left","right"→"943954" ※Rust実出力で確定) / `role_for_pair_is_complementary` / `role_assigns_host_to_lower_id`
- Rust: `peer_discovery.rs` tests に `room_id_for_pair_known_vector`。`signal_server.rs` に ack構築関数を抽出して `connection_request_ack_advertises_proto_2`、payloadビルダー抽出して `connection_request_payload_passes_valid_requester_role` / `..._omits_invalid_requester_role`、`should_reap` の2テスト。
- 新規 `src/features/realtime/realtimeClientIdentity.test.ts`(platformAdapter を vi.mock、stubチャネル `{readyState:"open", send:vi.fn(), close:vi.fn()}` で private メソッドを直接駆動): `control_open_keeps_status_connecting_until_identity_hello` / `identity_hello_verification_emits_connected_after_verified` / `text_send_before_verification_throws_identity_error` / `identity_timeout_emits_failed_and_closes_transport`(fake timers) / `server_error_closes_socket_without_reconnect` / `identity_hello_stable_peer_id_round_trip`(parseStablePeerId)
- 新規 `src/features/chat/connectGuard.test.ts`: `second_attempt_within_spacing_is_rejected` / `force_bypasses_spacing_but_not_inflight` / `inflight_blocks_other_conversations_too` / `attempt_allowed_after_end_and_spacing_elapsed`
- `chatStore.test.ts` 追加: `stores_stable_peer_id_without_changing_conversation_id` / flush述語を純関数 `selectPendingConnectionMessages(messages, conversationId)` に抽出して `flush_filter_selects_only_bound_conversation`(誤配送の回帰テスト)

### 5.8 Batch A の重要リスク

- **旧v0.6.2との相互接続**: 旧側は identity-hello を送らない(旧でも `beginIdentityHandshake` はデッドコード)ため、新↔旧のWebRTC接続は10秒タイムアウトで「相手を最新版にしてください」エラーになる。**これは意図した挙動変更**(検証なし接続を廃止)。ユーザーの2台(XPS-Notebook / HomeDesktop)は**両方とも v0.7.0 に更新が必要**。アップデータはピア接続に依存せずGitHubから取得するため更新自体は可能。リリースノートと証跡に明記すること。
- FNV移植ドリフト → クロス言語フィクスチャで検出。
- `lastAutoConnect` のstale closure → 必ず ref 化(5.2(c))。

### 5.9 Batch A 実装順

1. G-1 pairing.ts + テスト → 2. G-2 stablePeerId → 3. C-3/C-7 identity gating(+identity-hello拡張) → 4. C-4 error teardown → 5. BUG-031 + proto:2/requesterRole(signal_server.rs を1パスで) → 6. C-1 App.tsx 4経路 → 7. C-2 connectGuard → 8. C-5 bind+flush(6,7と同じApp.tsxパスでまとめて)

---

## 6. Batch B — UI/状態整合性修正(ユーザー症状「表示/UIがおかしい」対応)

### F-B1: テキストメッセージのACK喪失で「送信中/送信済み」のまま固まる (T-1 + T-11)

- **症状**: 送ったはずのメッセージが相手に届いていないのに✓表示、または再接続を跨ぐと永遠に送信中。
- **現状**: `chatStore.sendDraft` は `realtimeClient.sendText()` 直後に `status: "sent"` にする。ACK受信で `"received"`。ACKが失われるとそのまま。タイムアウトも再送もない。
- **重要な既存事実(再送の安全性)**: 受信側 `App.tsx` の `onText` は `messages.some((m) => m.id === input.id)` で**IDによる重複排除済み**。つまり同一メッセージの再送は冪等で安全。
- **修正設計**:
  1. `flushPendingConnectionMessages`(App.tsx ~1318)を拡張: 現在の `status==="queued" && error.code==="pending_connection"` に加え、**接続中の会話**の `sender==="me" && (kind text/link/code) && status==="sent"`(=ACK未達)のメッセージも再送対象にする。再送は `retryMessage` 経由ではなく `sendRealtimeMessage(message)` を直接呼び、成功時に status を "sent" のまま維持(ACKで "received" になる)。
  2. ACKタイムアウト: 既存の20秒バックグラウンドinterval(App.tsx ~303)に分岐追加 — `connectionStatus==="connected"` のとき、アクティブ会話の `status==="sent"` かつ `createdAt` が30秒より古いテキストメッセージを最大1回/interval再送する。無限再送を防ぐため `deliveryOutbox` の `attempts` を参照し **attempts >= 5 で `failMessage`**(error: `{code:"ack_timeout", message:"相手に届いたか確認できませんでした。再送してください。"}`)。
  3. `deliveryOutbox` の attempts 加算は既存 `createOutboxRecord`/`upsertOutboxForRetry` の仕組みを流用(chatStore ~1357-1381 参照)。
- **テスト** (`src/features/chat/chatStore.test.ts` に追加):
  - `resends unacked sent text on reconnect flush`(モックtransportで sent のまま → flush相当の再送関数を呼ぶ → transport が再度呼ばれる)
  - `ack timeout marks message failed after max attempts`
- **受け入れ基準**: 送信→ACK受信で"received"、ACKロスト→再接続で自動再送→受信側に重複表示なし。

### F-B2: キャンセル→再試行でメッセージとoutboxの状態が乖離 (T-6) + キャンセル後の完了イベントで状態が巻き戻る (BUG-013)

- **症状**: 送信待ちバッジが実際と合わない・キャンセルしたのに「送信済み」に変わる。
- **現状**: `cancelMessage`(chatStore ~311-320)と `retryMessage`(~321-370)が別々の `set()` でmessageとoutboxを更新。さらに `completeTransfer`/`updateTransferProgress` はメッセージが cancelled でも上書きする。
- **修正設計**(すべて `chatStore.ts` 内):
  1. `completeTransfer`, `failTransfer`, `updateTransferProgress`, `markMessageStatus` の冒頭にガード: 対象メッセージの現status が `"cancelled"` の場合は **無視して return**(cancelled は終端状態)。ただし `retryMessage` からの明示的な再開だけは `resetMessageForRetry` が status を戻すので影響なし。
  2. `retryMessage`: message更新とoutbox更新(`upsertOutboxForRetry`)を**同一の set() 内**で行うようリファクタリング。
  3. `cancelMessage`: 同上(message "cancelled" と outbox "cancelled" を1つの set() で)。既にそうなっているか確認し、なっていなければ統合。
- **テスト**: `completeTransfer after cancel keeps cancelled status` / `retry after cancel yields consistent message+outbox pair`(message.status と outbox.status の組を検証)。
- **受け入れ基準**: どの順序で cancel/complete/fail/retry イベントが来ても、pendingバッジ数 = 実際の queued/failed_retryable 件数。

### F-B3: 同じ相手なのに会話がIP変化で分裂する (BUG-052)

- **症状**: Wi-Fi⇔Tailscale切替やDHCP変更のたびに同じ相手の会話タブが増殖し、履歴が散逸する。「表示がおかしい」の代表格。
- **現状**: `conversationIdForPeer`(chatStore ~1632)が `peerId ?? peerHint ?? fingerprint` から会話IDを生成し、実際の呼び出し(`activateConversation`)は `peerId: selectedPeer.peerHint`(=IP)を渡すため、**会話ID = IPアドレス**になっている。
- **修正設計**(指紋ベースの実行時マージ。永続データ移行は不要):
  1. `chatStore.ts` に新アクション `adoptConversationIdentity(conversationId: string, trustedPeer: TrustedPeer)` を追加。動作:
     - `conversations` から `trustedPeer.fingerprint` が一致する**別の**会話を探す。
     - 見つからなければ: 現会話に `fingerprint` フィールドをセットして終了。
     - 見つかった場合(=同一デバイスの分裂タブ): **古い方の会話に統合**する。(a) `messages` の `conversationId` を統合先IDに付け替え、(b) unreadCount 合算、(c) `lastMessageAt/lastMessagePreview` は新しい方を採用、(d) `peerHint/source/platform/displayName` は**今回接続した最新値**で上書き、(e) `conversationDrafts` はテキストを連結・添付は結合、(f) 分裂側の会話とdraftを削除、(g) `activeConversationId` が分裂側だった場合は統合先に切替。
  2. `App.tsx` の `onIdentity` コールバック(~327、mismatch でない分岐)で、`setConversationTrustedPeer` の直後に `adoptConversationIdentity(activeConversationId, trustedPeer)` を呼ぶ。
  3. `deliveryOutbox` の `conversationId` も付け替えること(忘れると F-B2 のバッジ整合が壊れる)。
- **テスト** (`chatStore.test.ts`): `adoptConversationIdentity merges split conversations by fingerprint`(2会話+各メッセージ+outbox を用意→adopt→1会話にメッセージ・outbox・未読が統合される)/ `adopt with unknown fingerprint only tags conversation`。
- **受け入れ基準**: 同一相手とIP違いで2回接続しても会話タブは1つ。既存の分裂済みタブも、次にそれぞれの相手と接続した時点で自動統合される。

### F-B4: 再起動後に受信画像のプレビューが壊れる (T-7)

- **現状の疑い**: `completeTransfer` が blob URL を `previewUrl` に保存し、persist時に `withoutFile()`(chatStore ~1233)が `blob:` URLを除去 → 再起動後 previewUrl が無い。ただし `ImageCard.tsx:24-26` は `useLocalImagePreview(openPath)`(openPath = savePath ?? localPath)を最優先しており、**savePath があれば復元できる可能性が高い**。
- **作業指示**: まず実挙動を確認(受信画像メッセージを persist→リロード相当のstoreテストで検証)。壊れているのは「savePath が無い(保存前に閉じた/保存失敗)ケース」のみのはず。修正は:
  1. `completeTransfer`(chatStore)で `savePath` がある場合、`previewUrl` に blob URL を**残さない**(undefined にする)。表示は `useLocalImagePreview` 経由に一本化。
  2. `ImageCard.tsx` に `onError` フォールバック: `<img>` の onError で previewUrl を破棄し `filePreviewUrl(openPath)`(convertFileSrc)へ切替。openPath も無ければ「画像を開けません(ファイル移動/削除の可能性)」のプレースホルダ表示。
- **テスト**: storeレベルで `serializeMessagesForStorage strips blob urls but keeps savePath`(既存挙動の固定化)。UIフォールバックは手動確認項目(§9)へ。

### F-B5: localStorage クォータ超過でアプリが起動不能/設定消失 (BUG-032 PARTIAL)

- **現状**: zustand persist の storage は素の `localStorage`(chatStore ~1071)。`setItem` が QuotaExceededError を投げると persist が壊れる。メッセージは500件キャップ済みだが、`thumbnail`(base64)が大きいと超過し得る。
- **修正設計**:
  1. `createJSONStorage(() => localStorage)` をカスタムストレージでラップ: `setItem` を try-catch し、失敗時は (a) `console.error`、(b) 1回だけのリカバリとして messages を最新100件に間引いて再試行、(c) それでも失敗なら黙って諦める(アプリ動作は継続)。
  2. `serializeMessagesForStorage` で `thumbnail` が 32KB を超えるものは persist から除外(送受信には影響しない。表示は F-B4 のローカルファイル経路で復元される)。
- **テスト**: `persist setItem quota error does not throw`(モックstorageで例外→アプリ状態は正常)/ `oversized thumbnails are stripped from persisted messages`。

### F-B6: 再起動後の失敗添付「再送」がサイレントに何も起きない (BUG-055)

- **修正設計**: `chatStore.retryMessage` 冒頭で、asset/bundle メッセージについて `item.file` も `item.localPath` も無い項目が1つでもあれば、transport を呼ばずに `failMessage(messageId, {code:"source_missing", message:"元ファイルを開けません。ファイルを選び直して再送してください。"})` する。UIは既存のfailed表示が出るため追加不要。
- **テスト**: `retry without file or localPath fails with source_missing`。

### F-B7: 添付の件数/総量バリデーション欠如 (BUG-075 PARTIAL)

- **修正設計**: `chatStore.addAttachments` に上限を追加: 1メッセージあたり**最大30件**、合計**最大10GiB**(native転送の上限と一致; `transfer.rs` の10GiB制限に合わせる)。超過分は追加せず、戻り値または新state `attachmentWarning?: string` で「◯件は上限のため追加されませんでした」を返し、`App.tsx` が `setDiagnostic`(info)で1回表示。
- **テスト**: `addAttachments rejects beyond count and size limits`。

### F-B8: Tailscale判定のIPv6漏れ (BUG-054)

- **修正設計**: `App.tsx:1174` 付近 `request.peerHint.startsWith("100.")` を共通ヘルパー `isTailscaleAddress(host)` に抽出(`100.` プレフィックスに加えて `fd7a:115c:a1e0` プレフィックスも tailscale と判定)。`src/features/diagnostics/diagnosticsService.ts` か新規 `src/features/net/address.ts` に置き、単体テスト追加。

---

## 7. Batch C — 転送信頼性・リソースリーク修正

### F-C1: ネイティブ転送失敗時のフォールバックが停滞し 0% のまま (T-2) — **Critical**

- **症状**: ファイルが 0% のまま進まない(受信側は queued のまま)。
- **現状**: 送信側 `realtimeClient.ts` ~754 でネイティブTCP接続失敗を catch し WebRTC の `executeTransfer` に黙ってフォールバックするが、受信側は asset-start の `nativeKey` を見てネイティブ受信準備(`prepare_native_receive`)をしており、WebRTC 側の `request-transfer` を送ってこない → 両者すれ違いで永久停滞。
- **作業指示**: まず `requestNativeTransfer`(realtimeClient ~378-411)、asset-start 送受、`handleRequestTransfer`、フォールバック catch(~754)の実フローを読み、以下を実装:
  1. フォールバック時、送信側から control message `{type:"native-fallback", transferId, messageId}` を送る。
  2. 受信側は `native-fallback` 受信で: `cancel_native_receive`(チケット破棄、best-effort)→ 該当 transfer を WebRTC 受信モードに切替え、`request-transfer`(byteOffset=0)を送信側に送る(既存の WebRTC 受信開始経路を再利用)。
  3. 逆方向: 受信側の `prepare_native_receive` が失敗した場合も同様に WebRTC への `request-transfer` を送る(現状の挙動を確認し、停滞するなら同修正)。
  4. タイムアウト保険: 送信側は asset-start 送信後 **60秒** 以内に転送が開始(最初の progress)しなければ `onAssetFailed`(message: "転送を開始できませんでした。再試行してください。")。
- **テスト**: `realtimeProtocol.test.ts` に `native-fallback` メッセージの encode/decode テスト。フロー自体は §9 の実機確認項目。

### F-C2: バンドル再試行で送信済みファイルまで再送され受信側に重複保存 (T-3)

- **修正設計**: `sendRealtimeMessage`(App.tsx ~1479 bundleループ)で、各 item について `message` の transferState/asset 状態を確認し、**savePath 確定済み(=受信完了)または progress===100 の item はスキップ**する。判定は `chatStore` の `transferStates[transferId]` か item の status を使う(実装AIが確認)。加えて受信側 `receivePeerAsset`/`upsertBundleItem` は item の安定ID(`item.id`)で重複排除する(transferId でなく)。
- **テスト**: `chatStore.test.ts` — `receivePeerAsset dedupes bundle item by item id across retries`。

### F-C3: キャンセルの伝搬漏れとpartファイル残骸 (T-4 + T-9)

- **修正設計**:
  1. 受信側キャンセル時にネイティブ転送中なら、既存の `cancelTransfer` control 送信に加えて sender 側で `cancel_native_send` が呼ばれることを確認(呼ばれない経路があれば `onAssetCancelled` ハンドラで `platformAdapter.cancelNativeSend(transferId)` を呼ぶ)。
  2. **partファイルGC**: `src-tauri/src/commands/transfer_session.rs::start`(アプリ起動時)に、partファイル置き場の `*.part`(該当拡張子は実装確認)のうち**更新日時が7日より古いもの**を削除する処理を追加。対応する孤児セッションレコードも削除。
  3. `deletePartFile` の `.catch(() => undefined)` 箇所に `console.warn` を追加(黙殺しない)。
- **テスト**: Rust unit test — `startup gc removes stale part files`(tempdirに古いファイルを作って検証)。

### F-C4: フォルダ送信の一時zipが再試行のたび増殖・残留 (T-8 + BUG-003)

- **修正設計**:
  1. **起動時GC**: `fs.rs` に `cleanup_temporary_zips()` を追加 — `std::env::temp_dir()` の `KunoChat_Dir_*.zip` で**24時間より古いもの**を削除。`lib.rs` の setup から `tauri::async_runtime::spawn_blocking` で呼ぶ。
  2. **再zip抑制**: `sendRealtimeMessage`(App.tsx ~1430 と ~1486)で zip 成功後、`chatStore` に新アクション `markAssetZipped(messageId, itemId, {localPath, size, name, mime})` を追加してメッセージへ書き戻す。リトライ時は `item.localPath` が既に `.zip` を指す(かつ `isFolder` フラグと `name.endsWith(".zip")` で判別)場合は再zipせずそのまま使う。zipファイルの存在確認(`pathMetadata`)に失敗したら再zip。
  3. 送信完了/キャンセル/失敗時(completeTransfer/cancelTransfer/failTransfer の App.tsx 側ハンドラ)に `platformAdapter.deleteTemporaryZip(zipPath)` を呼ぶ(既存コマンド `delete_temporary_zip` あり。呼び出し漏れ経路を塞ぐ)。
- **テスト**: Rust — `cleanup_temporary_zips removes only old kunochat zips`。TS — `markAssetZipped updates bundle item path`。

### F-C5: バイナリチャネル切断で受信が N% のまま無限停滞 (T-10)

- **修正設計**: `realtimeClient.ts`:
  1. binary channel の `onclose`/`onerror` で、アクティブな incoming transfer 全てを `interrupted` 扱いにする(既存の `markInterruptedTransfers` 相当のコールバック `onAssetFailed` ではなく、再開可能な状態に**一時停止**させる。既存の reconnect→resume 経路があるか実装AIが確認し、なければ `onAssetFailed(message: "接続が切断されました。再接続後に再送してもらってください。")` で確実に終端させる)。
  2. 受信アイドルウォッチドッグ: incoming transfer ごとに最終チャンク受信時刻を記録し、ハートビートtick(既存10s interval)で **60秒無進捗なら失敗**させる。
- **テスト**: 手動確認項目(§9)。ロジック単体は `realtimeProtocol.test.ts` でチャンク時刻更新関数があればテスト。

### F-C6: WebRTC経路の大容量受信でレンダラOOM (BUG-007 + BUG-009)

- **現状**: native path(savePath 有り)は安全。WebRTC fallback のみ `persistReceivedAsset`(App.tsx ~1666)で `blob.arrayBuffer()`+`sha256ArrayBuffer` を全量メモリ実行。
- **修正設計**(キャップ方式・ストリーミング化はしない):
  1. 受信側: asset-start 受信時、`nativeKey` が無い(=WebRTC経路確定)かつ `meta.size > 512MiB` なら受信を拒否し、送信側へ `asset-failed`(message: "このサイズはネイティブ転送が必要です。両端末のKunoChatを最新にして再試行してください。")を返す。
  2. `persistReceivedAsset` 冒頭にも同じサイズガード(防御的二重化)。
- **テスト**: サイズガード関数を純関数に切り出して単体テスト(`webrtcSizeLimitExceeded(size)`)。

### F-C7: 小粒Rust修正まとめ(全てS)

| ID | ファイル | 修正 | テスト |
|---|---|---|---|
| BUG-038 | `transfer.rs` ~647 `nonce_bytes` | `expect` を `Result` 化しエラー伝搬(送信側は転送失敗として処理) | `nonce_bytes_rejects_overflow` |
| BUG-042 | `tray.rs` ~53 | `create_dir_all` の結果を確認し、成功時のみ `open::that` | 目視 |
| BUG-044 | `fs.rs` ~360-374 | `rand_hint`/`uuid_hint` を `rand_core::OsRng`(既存依存)で8バイト乱数hex化 | `temp_hints_are_unique`(1000回衝突なし) |
| BUG-022 | `fs.rs` ~203, ~275 | `dunce` クレート追加し `canonicalize` を `dunce::canonicalize` に置換(\\?\ プレフィックス除去) | `canonical_path_has_no_unc_prefix`(Windows) |
| BUG-068 | `fs.rs` `unique_save_path`+`File::create`/`finalize_part_file` | `OpenOptions::create_new(true)` によるアトミック作成+衝突時 `(n)` リトライループに変更 | `concurrent_saves_do_not_overwrite` |
| BUG-029 | `fs.rs` partファイル書込 | `transfer_id` キーの `Mutex` マップ(static, `transfer.rs` の `paused_sends` と同型)で seek+write を排他 | `concurrent_part_writes_do_not_corrupt` |

### F-C8: 添付プレビュー blob URL の残リーク (BUG-008 残り)

- **修正設計**: `clearHistory` / `cancelMessage` でメッセージを消す際、`previewUrl` が `blob:` のものは `URL.revokeObjectURL` を呼ぶ(既存の `revokeDraftAttachmentPreview`(chatStore ~1242)を流用)。10分で終わる規模でなければスキップ可(優先度最低)。

---

## 8. Batch D — 起動/OS互換の小修正(全てS・確実にやる)

| ID | ファイル:行 | 修正内容 | 検証 |
|---|---|---|---|
| F-D1 (BUG-058) | `lib.rs:42` | `native::shortcuts::register(app.handle())?;` の `?` を外し、`if let Err(e) = ... { eprintln!("shortcut registration failed: {e}"); }` に変更。**ショートカット競合で起動クラッシュしなくなる** | 他アプリでCtrl+Shift+Space占有→起動成功を手動確認 |
| F-D2 (BUG-059) | `lib.rs:11-15` single_instance コールバック | `window.show()` の前に `let _ = window.unminimize();` を追加 | 最小化中に2重起動→前面復元を手動確認 |
| F-D3 (BUG-061) | `tray.rs:~80` TrayIconBuilder | `.icon()` を明示指定: `if let Some(icon) = app.default_window_icon().cloned() { builder = builder.icon(icon); }` の形で panic しない実装 | 起動してトレイアイコン表示確認 |

---

## 9. 最終検証・証跡・リリース手順(一括リリース)

### 9.1 テスト(各Batch後+最後に全部)

```powershell
cd C:\Users\ymy26\Documents\KunoChat
npm run typecheck
npm test -- --run
npm run build
cd src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check --locked
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --locked --lib
```

注意: `Cargo.toml` に依存(`dunce`)を追加した場合は `--locked` が失敗するので、先に `cargo update -p dunce --precise <ver>` ではなく **`cargo check`(ロックなし)で Cargo.lock を更新してから** `--locked` で再実行し、`Cargo.lock` もコミットに含める。

### 9.2 実機smoke(可能な範囲で。2台目が無ければ1台+診断パネルで確認し、証跡に「未実施項目」として明記)

1. アプリ起動→トレイアイコン表示(F-D3)、最小化→2重起動で前面復元(F-D2)。
2. 設定→ネットワーク診断パネルが開き、待受3ポートOK表示。
3. 2台あれば: ペアリング→即メッセージ送信(C-3の verified 前送信が失敗しないこと)、切断→自動再接続→queuedメッセージ自動送信、キャンセル→再試行、フォルダ送信、画像送受信→両側プレビュー、アプリ再起動→画像プレビュー復元。

### 9.3 証跡ドキュメント

`docs/verification/2026-07-07-defect-elimination-v0.7.0.md` を新規作成し、以下を記載:
- 修正した欠陥の一覧(本書のID: C-*, T-*, F-*, BUG-*)と対応コミット
- 「bug_tickets.md 80件の検証結果」= §3 のサマリを転記(クローズ理由つき)
- 全テストコマンドの実行結果(件数)
- 実機確認した項目/できなかった項目
- **HomeDesktop事件の総括**: 2026-07-06の接続不能はリモート側でアプリが起動していなかっただけと判明済み(ファイアウォール起因ではない)。診断パネルはこの種の切り分けを迅速化するために追加した、と正確に記載する。

### 9.4 バージョン・コミット・リリース

1. バージョンを **0.7.0** に統一: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`(+ cargo check で `Cargo.lock` 更新)。
2. `npm run release:preflight` を実行(3ファイルのバージョン一致等を検証するスクリプト。既存)。
3. コミット: 論理単位で分割推奨(例: "Fix connection lifecycle defects", "Fix UI state consistency defects", "Fix transfer reliability and resource leaks", "Release v0.7.0")。**§1記載のユーザー私物ファイルを絶対に含めない**。各コミット末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
4. `git push`。
5. タグ `v0.7.0` を作成して push → `.github/workflows/release.yml` がタグトリガーでビルド・GitHub Release・`latest.json`(includeUpdaterJson: true)を生成する。Actions の完了と Release ページ・latest.json の存在を `gh run list` / `gh release view v0.7.0` で確認。
6. 完了報告に: 原因群、実装内容、検証結果、証跡ファイル、コミットhash、release URL を記載。

---

## 10. 今回実装しないことの明示(実装AIは着手しないこと)

- セキュリティ改修全般(§1の決定事項1)
- マルチNIC対応(BUG-001/018/078)、ディスク空き容量チェック(BUG-045)、IPC性能改善(BUG-056)、添付時サムネイル生成(BUG-067)、ブラウザモード専用問題(BUG-048, T-5)、接続拒否シグナル(BUG-072)
- 新機能の追加(診断パネル以外のUI新設など)

## 11. リスクと注意

- **C-1(roomId決定論化)は後方互換に注意**: 旧バージョン(0.6.2)の相手と接続する可能性があるため、受信側は旧形式の connection-request も引き続き受理すること(§5に詳細)。
- **F-B3(会話マージ)は破壊的操作**: マージ処理はテストを先に書き、messages/outbox/drafts/unread の4点全ての付け替えを検証してから結線する。
- 修正の際、前セッションの未コミット差分(診断機能)を上書き・削除しないこと。特に `App.tsx` は両方の変更が入る。
- 各修正は独立性が高い。1つの修正で回帰が出た場合はその修正だけ巻き戻して先へ進み、証跡に記録する。
