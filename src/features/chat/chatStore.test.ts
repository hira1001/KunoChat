import { beforeEach, describe, expect, test, vi } from "vitest";
import { useChatStore } from "./chatStore";
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
    messages: [],
    draftText: "",
    attachments: [],
    transferStates: {},
    isDraggingOver: false,
    peerTyping: false,
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

  test("updates typing state", () => {
    useChatStore.getState().setPeerTyping(true);
    expect(useChatStore.getState().peerTyping).toBe(true);
  });

  test("updates draft text", () => {
    useChatStore.getState().setDraftText("hello");
    expect(useChatStore.getState().draftText).toBe("hello");
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
    expect(useChatStore.getState().messages[0].status).toBe("failed");
  });

  test("clears draft after send", async () => {
    useChatStore.setState({ connectionStatus: "connected", draftText: "hello" });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().draftText).toBe("");
  });

  test("creates file message for a single attachment", async () => {
    useChatStore.setState({ connectionStatus: "connected", attachments: [attachment({ id: "file_1" })] });
    await useChatStore.getState().sendDraft(vi.fn());
    expect(useChatStore.getState().messages[0]).toMatchObject({ kind: "file", asset: { id: "file_1" } });
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

  test("deduplicates received text by message id", () => {
    const input = { id: "peer_msg", senderId: "peer", senderName: "Taro", createdAt: 1, text: "hello" };
    useChatStore.getState().receivePeerText(input);
    useChatStore.getState().receivePeerText(input);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  test("stores peer display name from received text", () => {
    useChatStore.getState().receivePeerText({ id: "peer_msg", senderId: "peer", senderName: "Taro", createdAt: 1, text: "hello" });
    expect(useChatStore.getState().settings.peerDisplayName).toBe("Taro");
  });

  test("starts receiving peer assets", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf", sha256: "abc" });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "receiving", progress: 0, size: 42, sha256: "abc" });
    expect(useChatStore.getState().messages[0].asset?.sha256).toBe("abc");
  });

  test("updates transfer progress on message and state", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().updateTransferProgress({ messageId: "asset_msg", transferId: "tr_1", progress: 55 });
    expect(useChatStore.getState().messages[0].progress).toBe(55);
    expect(useChatStore.getState().transferStates.tr_1.progress).toBe(55);
  });

  test("completes peer transfer with saved path", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().completeTransfer({ messageId: "asset_msg", transferId: "tr_1", savePath: "/tmp/a.pdf" });
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "received", progress: 100, asset: { savePath: "/tmp/a.pdf" } });
  });

  test("fails transfers with error details", () => {
    useChatStore.getState().receivePeerAsset({ id: "asset_msg", transferId: "tr_1", senderId: "peer", senderName: "Taro", createdAt: 1, kind: "file", name: "a.pdf", size: 42, mime: "application/pdf" });
    useChatStore.getState().failTransfer({ messageId: "asset_msg", transferId: "tr_1", message: "network" });
    expect(useChatStore.getState().messages[0]).toMatchObject({ status: "failed", error: { message: "network" } });
    expect(useChatStore.getState().transferStates.tr_1).toMatchObject({ status: "failed", error: { message: "network" } });
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
});
