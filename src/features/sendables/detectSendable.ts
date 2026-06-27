import type { DraftAttachment } from "../chat/messageTypes";
import type { SendableKind } from "./sendableTypes";

export function detectAttachmentKind(file: File): DraftAttachment["kind"] {
  return file.type.startsWith("image/") ? "image" : "file";
}

export function detectTextKind(text: string): SendableKind {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? "link" : "text";
  } catch {
    return text.includes("\n") && /[{}();]/.test(text) ? "code" : "text";
  }
}
