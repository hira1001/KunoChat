import type { DraftAttachment } from "../chat/messageTypes";
import { detectAttachmentKind } from "./detectSendable";

export function parseDroppedFiles(files: File[]): DraftAttachment[] {
  return files.map((file) => ({
    id: `drop_${crypto.randomUUID()}`,
    kind: detectAttachmentKind(file),
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    file
  }));
}
