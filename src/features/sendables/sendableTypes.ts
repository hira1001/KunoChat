import type { DraftAttachment } from "../chat/messageTypes";

export type SendableKind = "text" | "link" | "image" | "file" | "bundle" | "folder" | "code";

export type SendableDraft = {
  text: string;
  attachments: DraftAttachment[];
};
