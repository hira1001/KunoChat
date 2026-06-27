import { platformAdapter } from "../native/platformAdapter";
import type { AssetContent } from "../chat/messageTypes";

export async function sha256ForAsset(asset: Pick<AssetContent, "file" | "localPath">): Promise<string | undefined> {
  if (asset.localPath) {
    return platformAdapter.fileSha256(asset.localPath);
  }

  if (asset.file) {
    return sha256ArrayBuffer(await asset.file.arrayBuffer());
  }

  return undefined;
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
