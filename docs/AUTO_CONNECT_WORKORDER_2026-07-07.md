# KunoChat 自動接続化(選択レスUX)— 実装AI向け完全作業指示書

作成日: 2026-07-07 / 対象: `C:\Users\ymy26\Documents\KunoChat` (main, v0.7.0 リリース済みの状態から)

## 1. コンテキスト

- 現状、接続可能な相手との接続は「相手を選択する」操作が必要で、選択負荷がUX上不快(ユーザー本人の指摘)。
- ゴール: **「アプリを開いたら、選択なしで自動的にいつもの相手とつながっている」**。初回ペアリングも1台構成なら選択なし。
- 前提となる基盤は v0.7.0 で完成済み: 決定論的roomId収束(`roomIdForPair`/`roleForPair`+proto:2)、single-flight `connectGuard`、identity検証ゲート、`stablePeerId`学習、指紋ベース会話マージ(`adoptConversationIdentity`)、検出ピアの`reachable`フラグ、20秒バックグラウンド再接続ワーカー、接続要求の自動承認+グレアガード。本計画はこの基盤の上に「どの相手に自動でつなぐか」の決定エンジンを載せるもの。

### ユーザー決定事項(2026-07-07 確認済み・変更不可)

1. **案A(検出1台なら自動接続)は LAN + Tailscale 両方**に適用。
2. **設定トグルは置かない(常時ON)**。設定画面の変更は不要。
3. **案Cの自動画面切替は「アクティブ会話が空(peerHint無し)のときだけ」**。ユーザーが見ている会話を勝手に変えない。

### 検証済みの現状ファクト(再調査不要)

- 起動時: `currentView`は永続化されず常に"main"開始(chatStore merge ~1260)。復元された`activeConversationId`に対しmount時に `ensureActiveConversationConnection("open")` が発火(App.tsx ~308)→ **peerHintを持つ会話への再接続は既に自動**。
- 初回インストール時: `DEFAULT_CONVERSATION_ID` のみ、peerHint無し、mainビュー(ペアリング画面は自動では出ない)。
- 検出ピア: `kuno:auto-connect`リスナー(App.tsx ~648)が `upsertDetectedPeer` で管理。**dedupeキーは `${source}:${peerHint}` なので同一デバイスがlanとtailscaleで2エントリになる**。**Tauri経路では鮮度切れの削除が無い**(直近8件保持のみ。ブラウザ経路のみ10秒プルーニング)。`reachable?: boolean` あり。connected中はイベント破棄。
- `handleConnectDetectedPeer`(App.tsx ~1012): activateConversation → setLastAutoConnect → sendConnectionRequest(requesterRole) → proto交渉 → connectRealtime。**connectGuard未適用**(手動クリック前提だったため)。
- `activateConversation`(chatStore ~215)は**必ずアクティブ切替**(draftも入替)。**非アクティブなupsertアクションは存在しない**→新設が必要。
- `upsertConversation`(chatStore ~1996)はid一致でshallow-merge+`lastMessageAt`降順ソート。`conversationIdForPeer`は `peer_<sanitized peerHint>`。
- `lastConnectedAt` はアクティブ会話がconnectedになった時に記録され、永続化される(chatStore ~173)。
- Header(~144)の会話ドロップダウンは全conversationsを表示(displayName / StatusDot / プレビュー or peerHint / 未読・待ちバッジ)。**プログラム登録した会話もそのまま表示される**。
- 信頼はTOFU: `identityTrustStatus`は"new"|"trusted"のみで未知指紋でも接続続行(App onIdentityは"mismatch"のみ特別扱い)。**Tailnet自動信頼のための追加変更は不要**(案Bの実体は「会話リストへの自動登録」)。
- 20秒ワーカー(App.tsx ~317)は**アクティブ会話のみ**をダイヤル。`detectedPeers`はReact stateなので、interval内から読むには**ref化が必要**(既存の`lastAutoConnectRef`と同パターン)。

## 2. 設計概要

3つの案を1つの**自動接続決定エンジン**に統合する:

- **B(自動登録)**: `source==="tailscale"` の検出ピアを、会話リストに**非アクティブでupsert**(新store action `registerConversation`)。tailnetは本人のデバイスのみなので登録に確認不要。LANピアは登録しない(共用Wi-Fiで隣人を拾うリスク回避; 接続自体はAが担う)。
- **C(自動選択)**: アクティブ会話が空(peerHint無し)のとき、既知会話の中から接続先を自動選択して `handleSelectConversation`(既存の強制ダイヤル付き)で切替。優先順: (1)検出済み&到達可能な中で`lastConnectedAt`最大 → (2)未接続歴でも検出済み&到達可能が**ちょうど1つ**ならそれ → (3)検出されていなくても`lastConnectedAt`最大の会話(ダイヤルは安価で、相手が起きたら繋がる)。
- **A(自動ペアリング)**: peerHintを持つ会話が**1つも無い**(=真の初回)場合のみ、鮮度内(30秒)かつ`reachable!==false`の検出ピアを**デバイス単位でdedupe**(deviceName優先キー)して**ちょうど1台**なら `handleConnectDetectedPeer` を自動呼び出し。
- エンジンの発火点は3つ: 起動時(既存mount effect)、`kuno:auto-connect`受信時、既存20秒ワーカー。すべて view main/mini かつ 未接続状態のときのみ。

初回1台構成の体験: LAN → A が自動ペアリング。Tailnet → B が登録 → C が自動選択・ダイヤル。どちらも**ワンクリックもせずに接続**される。2台目以降のtailnetデバイスは B により勝手に会話リストに現れ、クリック1回で会話開始(以後は自動)。

---

## 3. 詳細設計

### 3.1 新規モジュール `src/features/chat/autoConnect.ts`(純関数・全てテスト対象)

```ts
import type { ConversationSummary } from "./messageTypes";

// App.tsx の DetectedPeer と同形。循環importを避けるためここに構造型を定義し、
// App.tsx 側は満たすだけ(DetectedPeer は AutoConnectPayload & {id, lastSeen})。
export type AutoConnectPeer = {
  peerHint: string;
  roomId: string;
  mode: "host" | "join";
  signalingUrl: string;
  source?: "lan" | "tailscale";
  deviceName?: string;
  platform?: string;
  reachable?: boolean;
  lastSeen: number;
};

export const PEER_FRESH_WINDOW_MS = 30_000;
// C の「検出されていない既定の相手」フォールバックは、これより古い相手は選ばない
// (何週間も前に一度繋いだだけの端末を20秒ごとに永久ダイヤルし続けるのを防ぐ)。
export const KNOWN_PEER_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30日

// 同一物理デバイスは lan:192.x と tailscale:100.x の2エントリで現れる(dedupeキーが
// source:peerHint のため)。deviceName(ホスト名)を優先キーにデバイス単位へ畳む。
export function deviceKeyForPeer(peer: Pick<AutoConnectPeer, "deviceName" | "peerHint">): string {
  return (peer.deviceName?.trim().toLowerCase() || peer.peerHint).toLowerCase();
}

// 鮮度内(30秒)かつ reachable !== false のピアをデバイス単位で1件に(最新lastSeen優先)。
export function distinctReachablePeers(peers: AutoConnectPeer[], now: number): AutoConnectPeer[];

// 案A: peerHint を持つ会話が1つも無い(=真の初回)ときのみ、distinct が「ちょうど1台」
// ならそのピアを返す。それ以外は undefined。
export function selectAutoPairTarget(
  peers: AutoConnectPeer[],
  conversations: ConversationSummary[],
  now: number
): AutoConnectPeer | undefined;

// 案C: アクティブ会話が空のときの自動選択。
// 会話⇔検出ピアのマッチ: conversation.peerHint === peer.peerHint、または
// conversation.displayName と peer.deviceName の大文字小文字無視一致。
// 優先: (1) 検出&到達可能な中で lastConnectedAt 最大
//       (2) 検出&到達可能で lastConnectedAt 無しが「ちょうど1つ」ならそれ(B登録直後の初回)
//       (3) 検出されていなくても lastConnectedAt が KNOWN_PEER_STALE_MS 以内で最大
//       (4) いずれも無ければ undefined
// 戻り値に matchedPeer を含め、会話の経路(peerHint)が検出経路と異なる場合の更新に使う。
export function selectAutoSwitchTarget(
  conversations: ConversationSummary[],
  peers: AutoConnectPeer[],
  now: number
): { conversation: ConversationSummary; matchedPeer?: AutoConnectPeer } | undefined;
```

**重要**: (3) のフォールバックは `now - (conversation.lastConnectedAt ?? 0) <= KNOWN_PEER_STALE_MS` の会話のみ対象。これがないと、何週間も前の端末を永久にダイヤルし続け、後から現れた別の既知端末に切り替わらなくなる(アクティブが非空になるため)。

実装注意:
- `distinctReachablePeers`: `now - peer.lastSeen <= PEER_FRESH_WINDOW_MS && peer.reachable !== false` でフィルタ後、`deviceKeyForPeer` で groupBy し各グループ `lastSeen` 最大の1件。
- `selectAutoSwitchTarget` の (3) は「検出ゼロでも既定の相手に自動で会話を開く」ための重要フォールバック。既存の自動待機UX(送信待ち+バナー)にそのまま乗る。
- (2) が複数(未接続歴の到達可能な既知相手が2台以上)の場合は**選ばない**(曖昧なときに勝手に決めない)。

### 3.2 chatStore への追加

**(a) `conversationIdForPeer` を export する**(現在は非公開ヘルパー、chatStore.ts ~1849)。App.tsx のガードキー算出で使用。

**(a-2) 共有マッチャ `matchConversationByDevice`**(chatStore内の非公開ヘルパー。registerConversation と後述の接続経路の**両方**が使い、経路(IP)違いによる会話分裂を根絶する):
```ts
function matchConversationByDevice(
  conversations: ConversationSummary[],
  input: { stablePeerId?: string; deviceName?: string; peerHint?: string }
): ConversationSummary | undefined {
  // ① stablePeerId 完全一致(接続後に学習済みの最も確実なキー)
  if (input.stablePeerId) {
    const byStable = conversations.find((c) => c.stablePeerId === input.stablePeerId);
    if (byStable) return byStable;
  }
  // ② deviceName(ホスト名)== displayName 大文字小文字無視・完全一致(両方非空)
  const name = input.deviceName?.trim().toLowerCase();
  if (name) {
    const byName = conversations.find((c) => c.displayName?.trim().toLowerCase() === name);
    if (byName) return byName;
  }
  // ③ peerHint 由来の id 一致(同一経路での再来)
  if (input.peerHint) {
    const id = conversationIdForPeer(input.peerHint);
    const byId = conversations.find((c) => c.id === id);
    if (byId) return byId;
  }
  return undefined;
}
```
部分一致は使わない(誤マージ防止)。ホスト名衝突(別マシンが同名)の可能性は §7 に明記。

**(b) 新アクション `registerConversation`**(型宣言を ChatStore 型 ~56 付近へ、実装を `setConversationStablePeerId` の隣へ):

```ts
registerConversation: (input: {
  peerHint: string;
  displayName?: string;
  source?: ConversationSummary["source"];
  platform?: string;
  stablePeerId?: string;
}) => string;
```

動作(**アクティブ切替・draft入替は一切しない**):
1. `matchConversationByDevice(state.conversations, input)` で既存会話を探す。
2. 見つかった場合: その会話に対し `upsertConversation` で `{ ...existing, ...(inputの非undefinedフィールド) }` をマージ(peerHint/source/platform/displayName/stablePeerId を現在の経路値で更新)。**会話idは変えない**(経路の付け替え。`adoptConversationIdentity` と同方針)。見つかった会話の id を返す。
3. 見つからない場合: `upsertConversation` で新規作成(`id: conversationIdForPeer(input.peerHint)`, `displayName: input.displayName || input.peerHint`, `peerHint`, `source ?? "unknown"`, `platform`, `stablePeerId`, `unreadCount: 0`, `connectionStatus: "pairing"`)。新 id を返す。
4. undefined を上書きしないこと(既存 `?? existing` パターン)。既存の必須フィールド(unreadCount, connectionStatus, lastMessageAt 等)を消さないよう `upsertConversation` のshallow-merge挙動に乗せる。

**(c) Header の空デフォルト会話の非表示(1行ポリッシュ)**: `Header.tsx` の `conversations.map`(~144)の直前で次のフィルタを適用:
```ts
conversations.filter((c) =>
  c.id !== DEFAULT_CONVERSATION_ID || Boolean(c.peerHint) || Boolean(c.lastMessageAt) || c.id === activeConversationId
)
```
`activeConversationId` の逃げ道により、切替直前(まだ空デフォルトがアクティブ)にリストが空描画にならない。totalUnread 等の集計(~35)は元の `conversations` のまま変更しない。`DEFAULT_CONVERSATION_ID` は `import { DEFAULT_CONVERSATION_ID } from "../features/chat/chatStore"` で取得。

### 3.3 App.tsx: 自動接続決定エンジン

**(a) 新 ref 2つ**(既存 `lastAutoConnectRef` の隣):
```ts
const detectedPeersRef = useRef<DetectedPeer[]>([]);          // interval/listenerから最新値を読むため
const autoPairAttemptAtRef = useRef(new Map<string, number>()); // 自動ペアリングのデバイス別スロットル
```
`useEffect(() => { detectedPeersRef.current = detectedPeers; }, [detectedPeers]);` を追加。

**(b) エンジン本体**(`ensureActiveConversationConnection` の直後に配置):
```ts
const AUTO_PAIR_RETRY_MS = 60_000;

function runAutoConnectTick(trigger: "open" | "resume" | "detect") {
  const state = useChatStore.getState();
  if (state.currentView !== "main" && state.currentView !== "mini") return;
  if (state.connectionStatus === "connected" || state.connectionStatus === "connecting" || state.connectionStatus === "reconnecting") return;

  const active = state.conversations.find((c) => c.id === state.activeConversationId);
  if (active?.peerHint) {
    // 既存挙動: アクティブ会話への再ダイヤル(guard/スロットルは内部)
    ensureActiveConversationConnection(trigger === "detect" ? "resume" : trigger);
    return;
  }

  const now = Date.now();
  // C: 既知会話への自動切替(アクティブが空のときだけ — ユーザー決定事項3)
  const switchTarget = selectAutoSwitchTarget(state.conversations, detectedPeersRef.current, now);
  if (switchTarget) {
    if (switchTarget.matchedPeer && switchTarget.matchedPeer.peerHint !== switchTarget.conversation.peerHint) {
      // 検出された最新経路に会話の接続先を更新してから切替(idは不変)
      registerConversation({
        peerHint: switchTarget.matchedPeer.peerHint,
        displayName: switchTarget.conversation.displayName,
        source: switchTarget.matchedPeer.source,
        platform: switchTarget.matchedPeer.platform
      });
    }
    handleSelectConversation(switchTarget.conversation.id); // 既存: select+強制ダイヤル(guard内蔵)
    return;
  }

  // A: 真の初回のみ、検出1台なら自動ペアリング
  const pairTarget = selectAutoPairTarget(detectedPeersRef.current, state.conversations, now);
  if (pairTarget) {
    const key = deviceKeyForPeer(pairTarget);
    const lastAt = autoPairAttemptAtRef.current.get(key) ?? Number.NEGATIVE_INFINITY;
    if (now - lastAt < AUTO_PAIR_RETRY_MS) return;
    autoPairAttemptAtRef.current.set(key, now);
    void handleConnectDetectedPeer(pairTarget, { auto: true }); // auto: mini中は画面を奪わない
  }
}
```

**(c) 発火点3つ(既存コードの置換/追記)**:
1. mount effect(~308): `ensureActiveConversationConnection("open")` を `runAutoConnectTick("open")` に置換(active に peerHint がある場合の挙動は engine 内で同一)。
2. 20秒ワーカー(~317): 本体の `ensureActiveConversationConnection("resume")` を `runAutoConnectTick("resume")` に置換(status 条件チェックはワーカー側の既存の if をそのまま残してよい — engine 内の status チェックと重複するが無害)。
3. `kuno:auto-connect` リスナー(~648)を次の順に再構成:
```ts
listen<AutoConnectPayload>("kuno:auto-connect", (event) => {
  const payload = event.payload;
  // B: tailnet デバイスは接続状態に関係なく会話リストへ自動登録(受動的・ダイヤルしない)
  if (payload.source === "tailscale") {
    registerConversation({
      peerHint: payload.peerHint,
      displayName: payload.deviceName || payload.peerHint,
      source: "tailscale",
      platform: payload.platform
    });
  }
  if (useChatStore.getState().connectionStatus === "connected") {
    return; // 既存: 接続中は検出リストを更新しない
  }
  setDetectedPeers((peers) => upsertDetectedPeer(peers, payload));
  detectedPeersRef.current = upsertDetectedPeer(detectedPeersRef.current, payload); // setStateの反映遅延を待たず即時判断
  runAutoConnectTick("detect");
});
```
   ※ `registerConversation` は store の分割代入に追加すること。

### 3.4 `handleConnectDetectedPeer` の堅牢化(~1012)— 自動呼び出し前提の再構成

シグネチャに `options` を追加: `async function handleConnectDetectedPeer(peer: DetectedPeer, options: { auto?: boolean } = {})`。本体を次の順序に再構成する(**順序が重要** — 検証で判明した穴を塞ぐ):

```ts
async function handleConnectDetectedPeer(peer: DetectedPeer, options: { auto?: boolean } = {}) {
  const sessionPeerId = sessionPeerIdRef.current;
  if (!sessionPeerId) return;

  // 1. デバイス統一解決(経路違いによる会話分裂を防ぐ)+ 経路更新。activateはまだしない。
  const conversationId = registerConversation({
    peerHint: peer.peerHint,
    displayName: peer.deviceName || peer.peerHint,
    source: peer.source,
    platform: peer.platform
  });

  // 2. ガードを最初に取る。破壊的な副作用(disconnect/diagnostic/setView)の前に bail する。
  if (!connectGuardRef.current.begin(conversationId, { force: true })) {
    return; // 進行中のダイヤルがある: 何も壊さず戻る(会話にpeerHintがあるので次tickが拾う)
  }

  try {
    if (useChatStore.getState().connectionStatus === "connected") {
      realtimeClient.disconnect();
    }
    // 3. 解決済みidをアクティブ化(activateConversationではなくselectConversationで既存idを開く)
    selectConversation(conversationId);
    // 4. mini中の自動起動は画面を奪わない(手動 or main のときだけ main へ)
    if (!options.auto || useChatStore.getState().currentView !== "mini") {
      setView("main");
    }

    const isLocalBrowserPeer = peer.signalingUrl === LOCAL_BROWSER_SIGNALING_URL;
    const roomId = peer.roomId;
    const requestUrl = signalingUrlForDetectedPeer(peer) ?? peer.signalingUrl;

    const applyLastAutoConnect = (payload: AutoConnectPayload) => {
      setLastAutoConnect(payload);
      lastAutoConnectRef.current = payload; // §3.6-1: グレアガードのために同期反映(必須)
    };

    if (isLocalBrowserPeer) {
      applyLastAutoConnect({ ...peer, roomId, mode: "join", signalingUrl: requestUrl });
      setDiagnostic({ tone: "info", title: "接続中", detail: `${peer.deviceName || "相手"} に接続しています。` });
      await connectRealtime(conversationId, { roomId, localPeerId: sessionPeerId, displayName: settings.displayName || "You", mode: "join", signalingUrl: requestUrl, trustedPeer: trustedPeerForConversation(conversationId) }).catch(() => undefined);
      return;
    }

    setDiagnostic({ tone: "info", title: "接続依頼を送信中", detail: `${peer.deviceName || peer.peerHint} に接続依頼を送っています。` });
    const ack = await sendConnectionRequest(requestUrl, { requestId: crypto.randomUUID(), roomId, requesterName: settings.displayName || "You", requesterPeerId: settings.localPeerId, requesterRole: peer.mode });
    const mode: "host" | "join" = ack.proto >= 2 ? peer.mode : "join";
    const connectSignalingUrl = mode === "host" ? runtimeConfig.signalingUrl : requestUrl;
    applyLastAutoConnect({ ...peer, roomId, mode, signalingUrl: connectSignalingUrl });
    setDiagnostic({ tone: "info", title: "承認待ち", detail: `${peer.deviceName || peer.peerHint} 側で接続を承認してください。` });
    await connectRealtime(conversationId, { roomId, localPeerId: sessionPeerId, displayName: settings.displayName || "You", mode, signalingUrl: connectSignalingUrl, nativeEndpoint: nativeEndpointForPeer(peer.peerHint), trustedPeer: trustedPeerForConversation(conversationId) }).catch(() => undefined);
  } catch (error) {
    // 既存の失敗ハンドリング(reachable=false 時の到達性ガイダンス等)をそのまま移植
    setConnectionStatus("failed");
    recordConnectionFailure(error instanceof Error ? error.message : "接続依頼を送れませんでした。");
    /* ...既存の unreachableSummary 分岐... */
  } finally {
    connectGuardRef.current.end(conversationId); // 全経路(early return除く)で必ず解放
  }
}
```

キー変更点:
- **connectRealtime を `void` から `await` に変更**し、guard.end を接続確立/失敗まで遅延(v0.7.0 `reconnectConversation` と同じ持ち方。socket open+join後に resolve するのでブロックは短い)。
- **guard.begin を disconnect/diagnostic/setView より前**に置く。旧コードは activateConversation→disconnect→diagnostic の後にダイヤルしていたため、進行中ダイヤルがあると「切断だけして何もしない」誤動作の余地があった。
- **`selectConversation(conversationId)`** で §3.2 の解決済みidを開く(activateConversation で新idを作らない = 分裂しない)。
- **早期 "connecting" セットは不要**: `connectRealtime`→`realtimeClient.connect`→`startConnection` が同期的に `onStatus("connecting")` を出す(realtimeClient.ts ~235、検証済み)。よってack待ちの窓でも store は既に "connecting" になり、相手のconnection-request に対する autoAcceptのグレアガードが機能する。ただしその機能は §3.6-1 の ref 同期が前提。

### 3.6 必須の設計修正(設計検証で判明した穴。省略不可)

対称的な自動接続では「両側が同時にダイヤルする」のが常態になるため、v0.7.0のグレア対策の前提が崩れる箇所がある。以下は**必ず**実装すること。

1. **`lastAutoConnectRef` を全ダイヤル経路で同期反映**(最重要): 現状 `lastAutoConnectRef` は `useEffect` 同期で1コミット遅れる。`autoAcceptConnectionRequest` のグレアガードはこの ref の roomId で判定するため、遅延窓に相手の connection-request が届くと **stale/undefined を見てガードが素通りし、確立中の接続を切って張り直す**。対策: **`setLastAutoConnect(x)` を呼ぶ全箇所の直後に `lastAutoConnectRef.current = x;` を同期実行**する。対象は `reconnectConversation`(~1195)、`handleConnect`(~1035, 1044)、`handleConnectDetectedPeer`(§3.4の`applyLastAutoConnect`で対応済み)、`autoAcceptConnectionRequest`(~1269)。既存の `useEffect` 同期は残してよい(冪等)。

2. **会話分裂の根絶**: `registerConversation` と `handleConnectDetectedPeer` の両方が `matchConversationByDevice`(§3.2a-2)経由で同一デバイスを1会話に解決する(§3.2b, §3.4で対応済み)。これを省くと、Tailscaleで登録した会話とLAN接続で作る会話が別idになり、`adoptConversationIdentity`(指紋マージ)は登録側に指紋が無いため**マージできず永続的に分裂**する。

3. **guard の取得順と解放**: §3.4の通り、`registerConversation`→`guard.begin`→(false なら破壊的副作用の前に return)。`connectRealtime` は `await` し、`finally` で必ず `guard.end`。early return(sessionPeerId無し・guard false)では guard を取得していないので end 不要。

4. **auto時の画面奪取抑制**: §3.4の `options.auto` で mini中の `setView("main")` を抑制(対応済み)。

5. **C フォールバックの鮮度上限**: `selectAutoSwitchTarget` の未検出フォールバックは `KNOWN_PEER_STALE_MS`(30日)以内のみ(§3.1で対応済み)。

6. **Header の空会話フィルタ**に `activeConversationId` 逃げ道(§3.2cで対応済み)。

### 3.5 UXフィードバック(最小限)

- 自動切替時(C): `handleSelectConversation` 内の既存フローが「自動接続中」diagnosticを出すため追加不要。
- 自動ペアリング時(A): `handleConnectDetectedPeer` 既存の「接続依頼を送信中」diagnosticで足りる。
- 新しいバナー・トースト・設定UIは**追加しない**(ユーザー決定事項2: トグルなし)。

---

## 4. テスト(実装と同時に追加)

**新規 `src/features/chat/autoConnect.test.ts`**(純関数、モック不要):
- `distinct_dedupes_lan_and_tailscale_entries_of_same_device`(同deviceNameの lan/tailscale 2エントリ → 1件、lastSeen新しい方)
- `distinct_excludes_stale_peers`(lastSeen が 30秒超過 → 除外)
- `distinct_excludes_unreachable_peers`(reachable === false → 除外; undefined は含む)
- `pair_target_requires_exactly_one_distinct_peer`(0台/2台 → undefined、1台 → そのピア)
- `pair_target_suppressed_when_any_known_conversation_exists`(peerHint持ち会話が1つでもあれば undefined)
- `switch_target_prefers_max_lastConnectedAt_among_detected`
- `switch_target_matches_by_deviceName_when_peerHint_differs`(会話peerHint=100.x、検出=lan:192.x 同名 → マッチ+matchedPeer返却)
- `switch_target_picks_single_never_connected_detected`(登録直後のtailnet 1台)
- `switch_target_ambiguous_never_connected_returns_undefined`(未接続歴2台 → undefined)
- `switch_target_falls_back_to_most_recent_known_when_nothing_detected`
- `switch_target_returns_undefined_with_no_candidates`

**`src/features/chat/chatStore.test.ts` に追加**:
- `registerConversation_creates_without_activating`(activeConversationId/draftText 不変、conversations に追加)
- `registerConversation_updates_existing_by_stablePeerId_and_by_displayName`(重複会話を作らない)
- `registerConversation_reroutes_peerHint_without_changing_id`(tailscale登録→同名でLAN経路のpeerHintに更新、id不変、会話数増えない = 分裂しない回帰テスト)
- `registerConversation_preserves_unread_and_messages`(既存の unreadCount/lastMessageAt を消さない)
- `conversationIdForPeer_is_exported_and_stable`(exportの回帰防止)

**手動スモーク(§5.2)でしか検証できない項目**: エンジン発火順、グレア(両側同時自動ペアリング)、B登録がHeaderリストに出ること。

---

## 5. 検証・リリース手順

### 5.0 前提
- 開始時に `git pull --ff-only`。v0.7.0 がリリース済み(GitHub Release + latest.json 確認済み)の main から開始。
- ユーザー私物ファイル(`bug_tickets.md`, `debug_and_test_report.md`, `detailed_causal_debug_report.md`, `docs/KunoChat_AI_Functional_Test_Report_2026-07-05_bundle/`, 削除済み `最高の設計書.md`, 未追跡 `設計書.md`)は**絶対に stage/commit/revert しない**。`git add -A` 禁止、ファイル明示指定。

### 5.1 実装順
1. `autoConnect.ts`(§3.1)+ テスト(純関数、依存なし)
2. chatStore: `conversationIdForPeer` export(§3.2a)+ `matchConversationByDevice`(§3.2a-2)+ `registerConversation`(§3.2b)+ ChatStore型宣言 + テスト
3. App.tsx: まず §3.6-1(全ダイヤル経路で `lastAutoConnectRef` 同期)→ §3.4(handleConnectDetectedPeer 再構成)→ §3.3(refs+`registerConversation`をstore分割代入に追加+エンジン+発火点3つ)
4. Header.tsx: 空デフォルト会話の非表示(§3.2c)
5. 各段階で: `npm run typecheck && npm test -- --run`。最後に `npm run build`。Rust変更なしだが念のため `cargo check --locked` を1回。

### 5.2 手動スモーク(1台でも可能な範囲)
1. 起動 → 既知会話が自動選択され「自動接続中」表示になる(相手不在なら自動待機バナー)。
2. localStorage をクリアして起動(初回状態) → もう1台が起動していれば選択なしで自動接続(2台あれば)。
3. Header のトーク一覧に tailnet デバイスが自動で載る(2台あれば)。空の「Peer」会話が載っていない。
4. 接続中に検出イベントが来ても画面が切り替わらない。会話X(相手オフライン)を開いている間、勝手に会話Yへ切り替わらない。
5. 2台あれば: 両方同時起動(グレア)で1本の接続に収束すること。

### 5.3 証跡・リリース
1. `docs/verification/2026-07-07-auto-connect-v0.8.0.md` を作成: 実装内容(A/B/C対応表)、テスト結果件数、手動確認した/できなかった項目、設計判断(LAN+TS両対応・トグルなし・空会話時のみ切替)を記録。
2. バージョン **0.8.0**: `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` を揃え、`cargo check` で `Cargo.lock` 更新、`npm run release:preflight` PASS を確認。
3. コミット(例: "Add selection-free auto-connect (single-peer auto-pair, tailnet auto-register, last-peer auto-select)" + "Release v0.8.0")。末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
4. `git push origin main` → タグ `v0.8.0` push → GitHub Actions release.yml が自動でRelease+latest.json生成(v0.7.0で実証済みの手順)。`https://api.github.com/repos/hira1001/KunoChat/releases/tags/v0.8.0` で draft=false と latest.json の存在を確認して完了報告。

---

## 6. スコープ外(実装しないこと)

- 複数同時接続/接続プール(案E)— realtime層の作り直しになるため対象外。
- LANピアの会話リスト自動登録(Bはtailscaleのみ。LANは共用Wi-Fiで他人を拾い得るため、接続はAの「1台のみ」条件に限定)。
- 設定トグル・新規バナーUI(ユーザー決定: 常時ON・UI追加なし)。
- ペアリング画面の廃止・改装(自動化後もフォールバックとして現状のまま残す)。
- アクティブ会話が非空のときの自動切替(ユーザー決定: しない)。

## 7. リスクと注意

- **§3.6-1(ref同期)と §3.6-2(会話分裂根絶)は必須**。省くと両側同時自動接続時にグレアガードが素通りして接続を壊す/会話が永続分裂する(設計検証で特定済み)。
- `matchConversationByDevice` の displayName マッチは大文字小文字無視の**完全一致のみ**(部分一致にしない — 誤マージ防止)。
- エンジンは必ず `useChatStore.getState()` と `detectedPeersRef` から読む(クロージャの stale state を読まない)。同期tick(check→dispatch の間に await を挟まない)。
- 既存テスト235+件を壊さないこと。特に chatStore の activateConversation 系テストと App の接続系挙動。
- 実装中に本計画と実コードの行番号がズレていても、シンボル名(関数名)で特定できる。シンボルが見つからない場合のみ立ち止まって整合を確認する。

### 既知の受容済み挙動(仕様。バグとして直そうとしないこと)

- **path A は既知会話が1つでもあると発火しない**(`selectAutoPairTarget` が peerHint持ち会話の存在で undefined)。これは意図通り: 既知端末があるなら C が担い、「検出1台を自動ペアリング」は真の初回専用。既知端末がある状態で**新規のLAN専用端末**を足すときは手動ペアリングが必要(安全側)。
- **ホスト名衝突**: 別マシンが同じ deviceName(例: "DESKTOP-PC"×2)だと `matchConversationByDevice`/`deviceKeyForPeer` が1台に畳む。家庭では稀。接続後に指紋不一致 diagnostic で気付ける。証跡に明記。
- **起動時 "reconnecting" デッドゾーン**: 終了時connectedだと merge で `connectionStatus: "reconnecting"` 復元(chatStore ~1261)。tickは reconnecting をスキップするため mount 直後は即ダイヤルせず、16秒タイムアウトが "failed" に倒してからワーカーが動く。既存挙動。
- **切断直後の検出リストは古い**: connected中は `kuno:auto-connect` を破棄するため、長時間セッション後の初回tickは検出マッチではなく C の未検出フォールバックを取ることがある。無害。
- **20秒ごとの永久リトライ**はアクティブ会話に peerHint がある限り既存挙動(相手が起きたら繋がる設計)。`KNOWN_PEER_STALE_MS` で「大昔の端末」への無限ダイヤルだけは抑止。
