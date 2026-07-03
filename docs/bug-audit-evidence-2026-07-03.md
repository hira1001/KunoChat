# KunoChat 監査バグ対応証跡 2026-07-03

## 判定方針

- Fixed: 実装で対策し、TypeScript型チェック・Vitest・Webビルドで検証済み。
- Partial: 実害を軽減したが、全OS/全経路/全設計までは未完了。
- Deferred: 家庭内利用・機能優先の方針により、意図的に後回し。
- Invalid/Already: 現コードでは再現しない、または既存実装で対策済みと判断。

## 検証コマンド

```powershell
git pull --rebase origin main
npx tsc --noEmit --pretty false
npm test
npm run build
npm run tauri:build
```

結果:

- `npx tsc --noEmit --pretty false`: pass
- `npm test`: pass, 10 files / 191 tests
- `npm run build`: pass
- `npm run tauri:build`: fail in this environment only because `cargo` is not installed (`program not found`)
- Browser smoke test: `http://127.0.0.1:1420/` loads, queued offline send shows `送信待ち`, no console errors

## 80件ステータス

| ID | Status | 根拠 / 対応 |
| --- | --- | --- |
| KUNO-BUG-001 | Partial | `src-tauri/src/native/peer_discovery.rs` の `local_ip_for_peer` は残存。自動再接続/手動選択UXは改善済みだが、NIC列挙による完全解決は未実装。 |
| KUNO-BUG-002 | Fixed | `tailscale_discovery.rs` に `DISCOVERY_ERROR_BACKOFF` を追加し、Tailscale未導入時の連続ポーリングを抑制。 |
| KUNO-BUG-003 | Fixed | `fs.rs::delete_temporary_zip` と `platformAdapter.createNativeBinarySource(..., deleteOnClose)` でフォルダ送信用一時zipを送信後に削除。 |
| KUNO-BUG-004 | Fixed | `identity.rs` にKeyring失敗時のファイルフォールバックを追加。起動停止を避ける。 |
| KUNO-BUG-005 | Fixed | `transfer_session.rs` の毎回 `sync_all()` を削除。転送セッション更新時の同期I/Oを軽減。 |
| KUNO-BUG-006 | Fixed | `realtimeClient.ts::waitForBinaryBuffer` をイベントリスナー+タイムアウト方式に変更し、ハンドラ上書きを排除。 |
| KUNO-BUG-007 | Partial | Tauri受信はpart fileへストリーム保存済み。画像プレビューも `convertFileSrc` 化。ただしブラウザfallbackはBlob結合が残る。 |
| KUNO-BUG-008 | Partial | ドラフト添付削除/クリア時に `URL.revokeObjectURL` を実行。送信済み表示中のBlob URLは表示維持のため残る。 |
| KUNO-BUG-009 | Partial | 受信画像の一括読み込みは除去。ブラウザFile送信時の `asset.file.arrayBuffer()` ハッシュ経路は残る。 |
| KUNO-BUG-010 | Invalid/Already | WebRTC/Nativeでチャンクサイズが異なるのは輸送路差による設計。上限検証は `MAX_ASSET_SIZE_BYTES` 等で実施。 |
| KUNO-BUG-011 | Invalid/Already | 低リスクの未使用コード指摘。実害なし。今回の機能優先修正対象外。 |
| KUNO-BUG-012 | Deferred | 強制自動承認はユーザー要件。「選んだ相手へ強制接続」を優先するため保留。 |
| KUNO-BUG-013 | Fixed | `chatStore.test.ts` のキャンセル後late failureテストで保護。キャンセル状態を後続失敗で上書きしない。 |
| KUNO-BUG-014 | Deferred | 送信後ドラフト消去はチャットアプリ標準挙動。再送はメッセージ単位で維持する方針。 |
| KUNO-BUG-015 | Deferred | アプリ終了時はプロセス終了で探索タスクも終了。明示キャンセルトークン化は将来改善。 |
| KUNO-BUG-016 | Fixed | `sanitize_filename` で `.` / `..` / 先頭末尾ドットを無害化。テスト追加済み。 |
| KUNO-BUG-017 | Deferred | Nonce/暗号厳密性は家庭内利用・機能優先方針により後回し。 |
| KUNO-BUG-018 | Partial | 複数NIC完全対応は未実装。手動相手選択/再接続UXで実害を軽減。 |
| KUNO-BUG-019 | Invalid/Already | `native/transfer.rs::read_frame` が `MAX_FRAME_BYTES` を検証。過大フレームは拒否。 |
| KUNO-BUG-020 | Partial | `transfer_session.rs` の永続化は動作継続。Windows rename完全耐性までは未検証。 |
| KUNO-BUG-021 | Fixed | `zip_dir_recursive` に訪問済みcanonical dir管理とWindows reparse point skipを追加。 |
| KUNO-BUG-022 | Partial | `canonicalize` 経路は残る。UNC prefixの実機再現が必要。 |
| KUNO-BUG-023 | Fixed | `Composer.tsx` が `event.nativeEvent.isComposing` を確認し、IME変換Enterを送信しない。 |
| KUNO-BUG-024 | Partial | Tauri drag-dropではフォルダを `pathMetadata` で処理。ブラウザ通常DnDのフォルダ展開は未対応。 |
| KUNO-BUG-025 | Fixed | `storage/db.ts` に `dbQueue` を追加し、SQLiteログ書き込みを直列化。 |
| KUNO-BUG-026 | Fixed | `clearHistory` がmessages/outbox/transferStates/unread/conversation previewを同期クリア。 |
| KUNO-BUG-027 | Fixed | `closeTransport()` がHeartbeat停止、`disconnect()` がreconnect timerをクリア。 |
| KUNO-BUG-028 | Partial | `startConnection()` は既存transportを閉じる。非同期世代トークンまでは未実装。 |
| KUNO-BUG-029 | Fixed | 受信part書き込みは `transfer.writeQueue` で直列化済み。 |
| KUNO-BUG-030 | Invalid/Already | Native transfer listenerはaccept失敗時に停止し、無限スピンしない。 |
| KUNO-BUG-031 | Partial | DataChannel heartbeatとWebSocket close/error再接続を追加。Signaling server側pingは未実装。 |
| KUNO-BUG-032 | Fixed | localStorage永続化を直近 `MAX_PERSISTED_MESSAGES = 500` に制限。 |
| KUNO-BUG-033 | Fixed | `App.tsx` のTauri `listen` はcleanupでunlisten済み。 |
| KUNO-BUG-034 | Deferred | Signaling join認証は家庭内利用・機能優先方針により保留。 |
| KUNO-BUG-035 | Partial | queue full時の完全な backpressure は未実装。接続再試行/heartbeatで欠落検知を改善。 |
| KUNO-BUG-036 | Deferred | デバイス署名の厳密なdomain separationはセキュリティ優先度を下げて保留。 |
| KUNO-BUG-037 | Fixed | UDP recv error時に100ms sleepを入れ、Windows ECONNRESETスピンを抑制。 |
| KUNO-BUG-038 | Invalid/Already | Native transferは10GiB制限によりsequence u32変換が安全域。 |
| KUNO-BUG-039 | Partial | Tailscale status失敗時は60秒backoff。TCP probeのblocking性は残る。 |
| KUNO-BUG-040 | Invalid/Already | Windows `explorer` には `/select,{path}` を単一引数で渡しており、スペース分割しない。 |
| KUNO-BUG-041 | Fixed | グローバル `Ctrl+O` / `Ctrl+Shift+V` 登録を削除し、表示切替のみ残した。 |
| KUNO-BUG-042 | Fixed | Tray `Open Downloads` が `KunoChat` フォルダを作成してから開く。 |
| KUNO-BUG-043 | Fixed | Signaling socket `close/error` で `scheduleReconnect()` を実行。 |
| KUNO-BUG-044 | Fixed | 一時zipは `OpenOptions::create_new(true)` + retryで競合上書きを防止。 |
| KUNO-BUG-045 | Partial | 書き込み失敗はエラー化されるが、事前の空き容量チェックは未実装。 |
| KUNO-BUG-046 | Deferred | ショートカット変更UIは機能優先範囲外。むしろ一般的global shortcutは削除済み。 |
| KUNO-BUG-047 | Fixed | `sendDraftInFlight` と専用テストで即時二重送信を防止。 |
| KUNO-BUG-048 | Partial | Tauri drag-dropはフォルダ対応。ブラウザ領域のフォルダ再帰読み取りは未対応。 |
| KUNO-BUG-049 | Deferred | 表示名バリデーション強化は保留。React表示なのでHTML注入リスクは限定的。 |
| KUNO-BUG-050 | Fixed | `realtimeClient.ts` にping/pong heartbeat、timeout、再接続移行を追加。 |
| KUNO-BUG-051 | Deferred | trusted peerの永続化厳密性は署名検証不要方針により保留。 |
| KUNO-BUG-052 | Partial | active conversationへのtrusted peer保存と返信会話保持は実装済み。fingerprint完全canonical ID化は未実装。 |
| KUNO-BUG-053 | Fixed | `sendConnectionRequest` のtimeout/ack/error/onerrorでsocketをclose。 |
| KUNO-BUG-054 | Fixed | auto accept時に `100.x` peerHintをTailscale sourceとして扱う。 |
| KUNO-BUG-055 | Partial | Tauri localPath付きファイルは再送可能。ブラウザFileだけの再起動後再送は未対応。 |
| KUNO-BUG-056 | Fixed | 通常転送はNative FileHandle/native TCPへ寄せ、JSON number[]転送を主要経路から外した。 |
| KUNO-BUG-057 | Fixed | binary frameの不正transfer idを拒否し、DataChannel message handlerで例外を捕捉。 |
| KUNO-BUG-058 | Fixed | global shortcut登録失敗はログ化して起動継続。 |
| KUNO-BUG-059 | Fixed | `tauri_plugin_single_instance` で既存windowをshow/focus。 |
| KUNO-BUG-060 | Deferred | TCP listener明示停止は未実装。プロセス終了で回収される前提。 |
| KUNO-BUG-061 | Invalid/Already | 現行アプリはtray起動済み。明示icon未指定による起動失敗は再現証跡なし。 |
| KUNO-BUG-062 | Fixed | `BundleCard` が全itemsをスクロール表示し、4件目以降も開ける。 |
| KUNO-BUG-063 | Fixed | `useLocalImagePreview` がまず `platformAdapter.filePreviewUrl` を使い、一括読み込みを避ける。 |
| KUNO-BUG-064 | Fixed | 画像表示は `convertFileSrc` 優先。Blob生成fallbackはTauri外/小容量限定。 |
| KUNO-BUG-065 | Partial | realtime status callbacksでZustand同期。全disconnect経路の実機検証は未完。 |
| KUNO-BUG-066 | Fixed | signaling未設定時にdiagnostic bannerを表示。 |
| KUNO-BUG-067 | Partial | ローカル画像はpreview URL表示。軽量サムネイル生成パイプラインは未実装。 |
| KUNO-BUG-068 | Partial | temp zipはcreate_new化。受信保存先のTOCTOU完全解消は未実装。 |
| KUNO-BUG-069 | Deferred | 表示名即時broadcastは保留。typing/再接続時に反映される。 |
| KUNO-BUG-070 | Deferred | P2P handshake metadata秘匿は家庭内利用・機能優先方針により保留。 |
| KUNO-BUG-071 | Deferred | Tauri fs scopeの厳密cleanupは保留。任意削除は避け、一時zipのみ管理削除。 |
| KUNO-BUG-072 | Invalid/Already | 接続要求は自動承認仕様。Decline応答UIを前提にしない。 |
| KUNO-BUG-073 | Fixed | binary send直前に `readyState === "open"` を再確認。 |
| KUNO-BUG-074 | Fixed | `MAX_RECONNECT_ATTEMPTS = 12` を追加し、無限再接続を停止。 |
| KUNO-BUG-075 | Fixed | 添付は30件/1ファイル10GiBまでに制限。 |
| KUNO-BUG-076 | Fixed | Settings/History両方の履歴消去にconfirmを追加。 |
| KUNO-BUG-077 | Partial | 転送履歴は `clearHistoryList()` でSQLite削除。会話削除機能との連動は対象機能なし。 |
| KUNO-BUG-078 | Partial | KUNO-BUG-001と同じく複数NIC完全解決は未実装。 |
| KUNO-BUG-079 | Invalid/Already | `sessionPeerIdRef` は初回renderで生成されるため、通常クリックで未ロード無視は起きにくい。 |
| KUNO-BUG-080 | Fixed | window focus / online / visibility復帰時に前回接続へ再接続を試行。 |

## 残課題

Fixed扱いではないものは合計43件。ただし、その内訳は「実害あり未完了」だけではない。

- Partial: 21件。主に複数NIC完全対応、ブラウザfallback、大容量空き容量事前検査、全OS実機検証。
- Deferred: 13件。主にセキュリティ厳密化・署名検証・認証・暗号秘匿。
- Invalid/Already: 9件。現コードでは再現しない、または既存実装で対策済み。

家庭内・機能優先の現方針で次に潰すなら、優先順は `001/078`, `022`, `028`, `031`, `045`, `068`。
