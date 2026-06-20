import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type PlatformName = "windows" | "macos" | "linux" | "unknown";

export type PlatformInfo = {
  platform: PlatformName;
  shortcut: string;
  revealLabel: string;
};

export type PickedFile = {
  id: string;
  name: string;
  size: number;
  mime: string;
  localPath?: string;
};

export type NativeFileMetadata = {
  name: string;
  size: number;
  localPath?: string;
};

export type NativePathMetadata = {
  name: string;
  size: number;
  isDir: boolean;
};

export type NativeNotification = {
  title: string;
  body: string;
};

const hasTauri = "__TAURI_INTERNALS__" in window;

export const platformAdapter = {
  async showMainWindow(): Promise<void> {
    if (hasTauri) {
      await invoke("show_main_window");
    }
  },

  async hideMainWindow(): Promise<void> {
    if (hasTauri) {
      await invoke("hide_main_window");
    }
  },

  async positionTopRight(): Promise<void> {
    if (hasTauri) {
      await invoke("position_top_right");
    }
  },

  async setAlwaysOnTop(enabled: boolean): Promise<void> {
    if (hasTauri) {
      await invoke("set_always_on_top", { enabled });
    }
  },

  async pickFiles(): Promise<PickedFile[]> {
    if (!hasTauri) {
      return [];
    }

    const selection = await open({
      multiple: true,
      directory: false
    });

    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    return Promise.all(
      paths.map(async (path, index) => {
        const fallbackName = path.split(/[\\/]/).pop() || `file-${index + 1}`;
        const metadata = await this.getFileMetadata(path).catch(() => ({
          name: fallbackName,
          size: 0
        }));
        const name = metadata.name || fallbackName;
        return {
          id: `picked_${Date.now()}_${index}`,
          name,
          size: metadata.size,
          mime: inferMime(name),
          localPath: path
        };
      })
    );
  },

  async getFileMetadata(path: string): Promise<NativeFileMetadata> {
    if (!hasTauri) {
      throw new Error("Native file metadata is only available in Tauri.");
    }

    return invoke<NativeFileMetadata>("file_metadata", { path });
  },

  async pathMetadata(path: string): Promise<NativePathMetadata> {
    if (!hasTauri) {
      throw new Error("Native path metadata is only available in Tauri.");
    }
    return invoke<NativePathMetadata>("path_metadata", { path });
  },

  async zipDirectory(dirPath: string): Promise<NativeFileMetadata> {
    if (!hasTauri) {
      throw new Error("Directory zipping is only available in Tauri.");
    }
    return invoke<NativeFileMetadata>("zip_directory", { dirPath });
  },

  async unzipFile(zipPath: string, destDir: string): Promise<string> {
    if (!hasTauri) {
      throw new Error("Zip extraction is only available in Tauri.");
    }
    return invoke<string>("unzip_file", { zipPath, destDir });
  },

  async readFileChunk(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    if (!hasTauri) {
      throw new Error("Native file reads are only available in Tauri.");
    }

    const bytes = await invoke<number[]>("read_file_chunk", { path, offset, length });
    return new Uint8Array(bytes).buffer;
  },

  async fileSha256(path: string): Promise<string> {
    if (!hasTauri) {
      throw new Error("Native file hashing is only available in Tauri.");
    }

    return invoke<string>("file_sha256", { path });
  },

  async saveReceivedFile(name: string, bytes: ArrayBuffer): Promise<string | undefined> {
    if (!hasTauri) {
      return undefined;
    }

    const payload = Array.from(new Uint8Array(bytes));
    return invoke<string>("save_received_file", { filename: name, bytes: payload });
  },

  async writePartChunk(transferId: string, bytes: ArrayBuffer): Promise<number> {
    if (!hasTauri) {
      throw new Error("writePartChunk is only available in Tauri.");
    }
    const payload = Array.from(new Uint8Array(bytes));
    return invoke<number>("write_part_chunk", { transferId, bytes: payload });
  },

  async getPartFileSize(transferId: string): Promise<number> {
    if (!hasTauri) {
      return 0;
    }
    return invoke<number>("get_part_file_size", { transferId });
  },

  async finalizePartFile(transferId: string, filename: string): Promise<string> {
    if (!hasTauri) {
      throw new Error("finalizePartFile is only available in Tauri.");
    }
    return invoke<string>("finalize_part_file", { transferId, filename });
  },

  async deletePartFile(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await invoke<void>("delete_part_file", { transferId });
  },

  async readEntireFile(path: string, size: number): Promise<ArrayBuffer> {
    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    const chunkSize = 1024 * 1024;
    while (offset < size) {
      const chunk = await this.readFileChunk(path, offset, Math.min(chunkSize, size - offset));
      if (chunk.byteLength === 0) {
        break;
      }
      chunks.push(chunk);
      offset += chunk.byteLength;
    }
    const output = new Uint8Array(offset);
    let writeOffset = 0;
    for (const chunk of chunks) {
      output.set(new Uint8Array(chunk), writeOffset);
      writeOffset += chunk.byteLength;
    }
    return output.buffer;
  },

  async pickFolder(): Promise<string | undefined> {
    if (!hasTauri) {
      return undefined;
    }

    const selection = await open({
      multiple: false,
      directory: true
    });

    return Array.isArray(selection) ? selection[0] : (selection ?? undefined);
  },

  async openPath(path: string): Promise<void> {
    if (hasTauri) {
      await invoke("open_path", { path });
    }
  },

  async revealPath(path: string): Promise<void> {
    if (hasTauri) {
      await invoke("reveal_path", { path });
    }
  },

  async showNotification(input: NativeNotification): Promise<void> {
    if (hasTauri) {
      await invoke("notify_message", input);
    }
  },

  async setAutostart(enabled: boolean): Promise<void> {
    if (hasTauri) {
      await invoke("set_launch_at_login", { enabled });
    }
  },

  async getPlatform(): Promise<PlatformInfo> {
    if (!hasTauri) {
      return {
        platform: "unknown",
        shortcut: "CommandOrControl + Shift + Space",
        revealLabel: "Reveal"
      };
    }

    return invoke<PlatformInfo>("get_platform_info");
  },

  inferMime(name: string): string {
    return inferMime(name);
  }
};

function inferMime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extension ?? "")) {
    return `image/${extension === "jpg" ? "jpeg" : extension}`;
  }
  if (extension === "pdf") {
    return "application/pdf";
  }
  if (extension === "zip") {
    return "application/zip";
  }
  return "application/octet-stream";
}
