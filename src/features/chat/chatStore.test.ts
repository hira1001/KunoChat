import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONVERSATION_ID, useChatStore } from "./chatStore";
import type { DraftAttachment } from "./messageTypes";

function attachment(overrides: Partial<DraftAttachment> = {}): DraftAttachment {
  return {
    id: overrides.id ?? `att_${crypto.randomUUID()}`,
    kind: overrides.kind ?? "file",
    name: overrides.name ?? "doc.pdf",
    size: overrides.size ?? 24,
    mime: overrides.mime ?? "application/pdf",
    localPath: overrides.localPath,
    previewUrl: overrides.previewUrl,
    file: overrides.file
  };
}

function resetStore() {
  useChatStore.setState({
    currentView: "main",
    connectionStatus: "pairing",
    activeConversationId: DEFAULT_CONVERSATION_ID,
    conversations: [
      {
        id: DEFAULT_CONVERSATION_ID,
        displayName: "Peer",
        source: "unknown",
        unreadCount: 0,
        connectionStatus: "pairing"
      }
    ],
    conversationDrafts: {
      [DEFAULT_CONVERSATION_ID]: { draftText: "", attachments: [] }
    },
    messages: [],
    draftText: "",
    attachments: [],
    transferStates: {},
    unreadCount: 0,
    isDraggingOver: false,
    peerTyping: false,
    peerTypingAt: 0,
    settings: {
      ...useChatStore.getState().settings,
      displayName: "Tester",
      peerDisplayName: undefined,
      alwaysOnTop: false
    }
  });
}

describe("chatStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
    resetStore();
  });

  test("starts on main view after reset", () => {
    expect(useChatStore.getState().currentView).toBe("main");
  });

  test("updates view", () => {
    useChatStore.getState().setView("settings");
    expect(useChatStore.getState().currentView).toBe("settings");
  });

  test("updates connection status", () => {
    useChatStore.getState().setConnectionStatus("connected");
    expect(useChatStore.getState().connectionStatus).toBe("connected");
  });

  test("caps unread messages at 99 and clears them when opened", () => {
    for (let index = 0; index < 101; index += 1) {
      useChatStore.getState().incrementUnread();
    }
    expect(useChatStore.getState().unreadCount).toBe(99);

    useChatStore.getState().clearUnread();
    expect(useChatStore.getState().unreadCount).toBe(0);
  });

  test("updates typing state", () => {
    useChatStore.getState().setPeerTyping(true);
    expect(useChatStore.getState().peerTyping).toBe(true);
  });

  test("ignores an out-of-order typing event", () => {
    useChatStore.getState().setPeerTyping(false, 200);
    useChatStore.getState().setPeerTyping(true, 100);
    expect(useChatStore.getState().peerTyping).toBe(false);
    expect(useChatStore.getState().peerTypingAt).toBe(200);
  });

  test("updates draft text", () => {
    useChatStore.getState().setDraftText("hello");
    expect(useChatStore.getState().draftText).toBe("hello");
  });

  test("keeps drafts per conversation", () => {
    const peerConversationId = useChatStore.getState().activateConversation({ peerId: "peer_a", displayName: "Peer A" });
    useChatStore.getState().setDraftText("hello a");
    useChatStore.getState().selectConversation(DEFAULT_CONVERSATION_ID);
    useChatStore.getState().setDraftText("hello default");
    useChatStore.getState().selectConversation(peerConversationId);
    expect(useChatStore.getState().draftText).toBe("hello a");
  });

  test("adds attachments", () => {
    useChatStore.getState().addAttachments([attachment({ id: "a" })]);
    expect(useChatStore.getState().attachments).toHaveLength(1);
  });

  test("removes attachments", () => {
    useChatStore.getState().addAttachments([attachment({ id: "a" }), attachment({ id: "b" })]);
    useChatStore.getState().removeAttachment("a");
    expect(useChatStore.getState().attachments.map((item) => item.id)).toEqual(["b"]);
  });

  test("clears attachments", () => {
    useChatStore.getState().addAttachments([attachment({ id: "a" })]);
    useChatStore.getState().clearAttachments();
    expect(useChatStore.getState().attachments).toHaveLength(0);
  });

  test("does not send empty drafts", async () => {
    await useChatStore.getState().sendDraft();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  test("blocks sending while disconnected", async () => {
    useChatStore.getState().setDraftText("hello");
    await useChatStore.getState().sendDraft();
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "system", status: "failed" });
  });

  test("optimistically sends text when connected", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: " hello " });
    await useChatStore.getState().sendDraft();
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "text", status: "failed" });
  });

  test("marks text sent when transport resolves", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "text", status: "sent" });
  });

  test("marks text failed when transport rejects", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(() => Promise.reject(new Error("nope")));
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "failed", error: { message: "nope" } });
  });

  test("clears draft after send", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().draftText).toBe("");
  });

  test("creates file message for a single attachment", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1" })] });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "file", status: "queued", asset: { id: "file_1" } });
  });

  test("creates image message for a single image attachment", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "img_1", kind: "image", mime: "image/png" })] });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "image", asset: { id: "img_1" } });
  });

  test("creates bundle for text plus attachment", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "caption", attachments: [attachment({ id: "file_1" })] });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "bundle", bundle: { caption: "caption", count: 1 } });
  });

  test("creates bundle for multiple attachments", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "a" }), attachment({ id: "b", size: 10 })] });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "bundle", bundle: { count: 2, totalSize: 34 } });
  });

  test("assigns a unique transfer id to each bundled asset", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "a" }), attachment({ id: "b", size: 10 })] });
    await useChatStore.getState().sendDraft(vi.fn());

    const items = useChatStore.getState().messages[0].bundle?.items ?? [];
    expect(new Set(items.map((item) => item.transferId)).size).toBe(items.length);
  });

  test("deduplicates received text by message id", () => {
    const input = { id: "peer_msg", senderId: "peer", senderName: "Taro", createdAt: 1, text: "hello" };
    useChatStore.getState().receivePeerText(input);
    useChatStore.getState().receivePeerText(input);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  test("routes peer messages into separate conversations", () => {
    useChatStore.getState().receivePeerText({ id: "peer_a_msg", senderId: "peer_a", senderName: "Peer A", createdAt: 1, text: "hello a" });
    useChatStore.getState().receivePeerText({ id: "peer_b_msg", senderId: "peer_b", senderName: "Peer B", createdAt: 2, text: "hello b" });

    const messages = useChatStore.getState().messages;
    const peerAConversation = useChatStore.getState().conversations.find((conversation) => conversation.displayName === "Peer A");
    const peerBConversation = useChatStore.getState().conversations.find((conversation) => conversation.displayName === "Peer B");

    expect(peerAConversation?.id).toBeTruthy();
    expect(peerBConversation?.id).toBeTruthy();
    expect(messages.find((message) => message.id === "peer_a_msg")?.conversationId).toBe(peerAConversation?.id);
    expect(messages.find((message) => message.id === "peer_b_msg")?.conversationId).toBe(peerBConversation?.id);
  });

  test("stores peer display name from received text", () => {
    useChatStore.getState().receivePeerText({ id: "peer_msg", senderId: "peer", senderName: "Taro", createdAt: 1, text: "hello" });
    expect(useChatStore.getState().settings.peerDisplayName).toBe("Taro");
  });

  test("starts receiving peer assets", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf", sha256: "abc" });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "queued", progress: 0, size: 42, sha256: "abc" });
    expect(useChatStore.getState().messages[0].asset?.sha256).toBe("abc");
  });

  test("updates transfer progress on message and state", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().updateTransferProgress({ messageId: "asset_msg", transferId: "tr_1", progress: 55 });
    expect(useChatStore.getState().messages[0].progress).toBe(55);
    expect(useChatStore.getState().transferStates.tr_1.progress).toBe(55);
  });

  test("moves an outgoing asset from queued to sending only when bytes begin transferring", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1" })] });
    await useChatStore.getState().sendDraft(vi.fn());
    const message = useChatStore.getState().messages[0];
    const transferId = message.asset?.transferId ?? "";

    useChatStore.getState().updateTransferProgress({ messageId: message.id, transferId, progress: 10, receivedBytes: 10 });

    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "sending", progress: 10 });
    expect(useChatStore.getState().transferStates[transferId]).toMatchObject({ status: "sending", progress: 10 });
  });

  test("completes peer transfer with saved path", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().completeTransfer({ messageId: "asset_msg", transferId: "tr_1", savePath: "/tmp/a.pdf" });
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "received", progress: 100, asset: { savePath: "/tmp/a.pdf" } });
  });

  test("stores late transfer hash when a transfer completes", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().completeTransfer({ messageId: "asset_msg", transferId: "tr_1", sha256: "verified-hash" });
    expect(useChatStore.getState().messages[0].asset?.sha256).toBe("verified-hash");
    expect(useChatStore.getState().transferStates.tr_1.sha256).toBe("verified-hash");
  });

  test("fails transfers with error details", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().failTransfer({ messageId: "asset_msg", transferId: "tr_1", message: "network" });
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "failed", error: { message: "network" } });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "failed", error: { message: "network" } });
  });

  test("cancels an incoming transfer with error details", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().cancelTransfer({ messageId: "asset_msg", transferId: "tr_1", message: "cancelled by peer" });

    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "cancelled",
      error: { code: "transfer_cancelled", message: "cancelled by peer" }
    });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({
      status: "cancelled",
      error: { code: "transfer_cancelled", message: "cancelled by peer" }
    });
  });

  test("cancels an outgoing text message immediately", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    void useChatStore.getState().sendDraft(() => new Promise(() => undefined));
    await Promise.resolve();

    const messageId = useChatStore.getState().messages[0].id;
    const notify = vi.fn();
    useChatStore.getState().cancelMessage(messageId, notify);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: messageId }), []);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "cancelled",
      error: { code: "transfer_cancelled" }
    });
  });

  test("cancels an outgoing file message and records transfer state", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1", localPath: "/tmp/doc.pdf" })] });
    void useChatStore.getState().sendDraft(() => new Promise(() => undefined));
    await Promise.resolve();

    const message = useChatStore.getState().messages[0];
    const transferId = message.asset?.transferId ?? "";
    const notify = vi.fn();
    useChatStore.getState().cancelMessage(message.id, notify);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: message.id }), [transferId]);
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "cancelled" });
    expect(useChatStore.getState().transferStates[transferId]).toMatchObject({
      status: "cancelled",
      progress: 0,
      error: { code: "transfer_cancelled" }
    });
  });

  test("keeps a cancelled in-flight send from being overwritten by a late failure", async () => {
    let rejectTransport!: (error: Error) => void;
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    const sendPromise = useChatStore.getState().sendDraft(
      () =>
        new Promise<void>((_, reject) => {
          rejectTransport = reject;
        })
    );
    await Promise.resolve();

    const messageId = useChatStore.getState().messages[0].id;
    useChatStore.getState().cancelMessage(messageId);
    rejectTransport(new Error("late network failure"));
    await sendPromise;

    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "cancelled",
      error: { code: "transfer_cancelled" }
    });
  });

  test("marks interrupted outgoing messages as retryable failures", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    void useChatStore.getState().sendDraft(() => new Promise(() => undefined));
    await Promise.resolve();

    useChatStore.getState().markInterruptedTransfers("lost link");

    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "failed",
      error: { code: "connection_interrupted", message: "lost link" }
    });
  });

  test("retries a failed text message", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(() => Promise.reject(new Error("offline")));
    const messageId = useChatStore.getState().messages[0].id;
    const transport = vi.fn();

    await useChatStore.getState().retryMessage(messageId, transport);

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ id: messageId, status: "sending" }));
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "sent", error: undefined });
  });

  test("keeps failed retry visible when transport rejects again", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(() => Promise.reject(new Error("offline")));
    const messageId = useChatStore.getState().messages[0].id;

    await useChatStore.getState().retryMessage(messageId, () => Promise.reject(new Error("still offline")));

    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "failed",
      error: { code: "retry_failed", message: "still offline" }
    });
  });

  test("rejects asset retry when the local payload is no longer available", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1" })] });
    await useChatStore.getState().sendDraft(() => Promise.reject(new Error("offline")));
    const messageId = useChatStore.getState().messages[0].id;

    await useChatStore.getState().retryMessage(messageId, vi.fn());

    expect(useChatStore.getState().messages[0]).toMatchObject({
      status: "failed",
      error: { code: "payload_unavailable" }
    });
  });

  test("retries a file message when a native local path is available", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1", localPath: "/tmp/doc.pdf" })] });
    await useChatStore.getState().sendDraft(() => Promise.reject(new Error("offline")));
    const messageId = useChatStore.getState().messages[0].id;
    const transferId = useChatStore.getState().messages[0].asset?.transferId;
    const transport = vi.fn();

    await useChatStore.getState().retryMessage(messageId, transport);

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ id: messageId, status: "sending" }));
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "queued", asset: { localPath: "/tmp/doc.pdf" } });
    expect(useChatStore.getState().transferStates[transferId!]).toMatchObject({ status: "queued", progress: 0, localPath: "/tmp/doc.pdf" });
  });

  test("resets a failed incoming asset when the peer retries the same message", () => {
    const input = { id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file" as const, name: "a.pdf", size: 42, mime: "application/pdf" };
    useChatStore.getState().receivePeerAsset(input);
    useChatStore.getState().failTransfer({ messageId: "asset_msg", transferId: "tr_1", message: "network" });

    useChatStore.getState().receivePeerAsset(input);

    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "queued", progress: 0, error: undefined });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "queued", progress: 0 });
  });

  test("resets a cancelled incoming asset when the peer retries the same message", () => {
    const input = { id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file" as const, name: "a.pdf", size: 42, mime: "application/pdf" };
    useChatStore.getState().receivePeerAsset(input);
    useChatStore.getState().cancelTransfer({ messageId: "asset_msg", transferId: "tr_1", message: "cancelled" });

    useChatStore.getState().receivePeerAsset(input);

    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "queued", progress: 0, error: undefined });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "queued", progress: 0 });
  });

  test("updates settings without dropping existing values", () => {
    useChatStore.getState().updateSettings({ displayName: "Ren" });
    expect(useChatStore.getState().settings).toMatchObject({ displayName: "Ren", saveFolder: "~/Downloads/KunoChat" });
  });

  test("clears message history", () => {
    useChatStore.getState().receivePeerText({ id: "peer_msg", senderId: "peer", senderName: "Taro", createdAt: 1, text: "hello" });
    useChatStore.getState().clearHistory();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  test("requests manual download and transitions status to receiving", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    expect(useChatStore.getState().messages[0].status).toBe("queued");

    useChatStore.getState().requestDownload("asset_msg");
    expect(useChatStore.getState().messages[0].status).toBe("receiving");
  });

  test("stores thumbnail metadata when receiving peer asset", () => {
    const input = {
      id: "asset_msg_thumb",
      transferId: "tr_thumb",
      senderId: "peer",
      senderName: "Taro",
      createdAt: 1,
      kind: "image" as const,
      name: "image.png",
      size: 1024,
      mime: "image/png",
      thumbnail: "data:image/jpeg;base64,abc"
    };
    useChatStore.getState().receivePeerAsset(input);
    const storedMsg = useChatStore.getState().messages.find(m => m.id === "asset_msg_thumb");
    expect(storedMsg?.asset?.thumbnail).toBe("data:image/jpeg;base64,abc");
  });
});
