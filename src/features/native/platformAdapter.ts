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
