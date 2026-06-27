import type { DraftAttachment } from "../chat/messageTypes";

export function parseClipboardItems(items: DataTransferItemList): DraftAttachment[] {
  return Array.from(items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map((file) => ({
      id: `paste_${crypto.randomUUID()}`,
      kind: file.type.startsWith("image/") ? "image" : "file",
      name: file.name || `Screenshot ${new Date().toTimeString().slice(0, 5).replace(":", "-")}.png`,
      size: file.size,
      mime: file.type || "application/octet-stream",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      file
    }));
}
