import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openNativeFile, SeekMode, type FileHandle } from "@tauri-apps/plugin-fs";

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

export type NativeBinaryFileSource = {
  size: number;
  readChunk: (offset: number, length: number) => Promise<ArrayBuffer>;
  close: () => Promise<void>;
  nativePath: string;
};

export type NativeReceiveInput = {
  transferId: string;
  messageId: string;
  expectedSize: number;
  key: string;
};

export type NativeSendInput = {
  transferId: string;
  messageId: string;
  path: string;
  remoteEndpoint: string;
  expectedSize: number;
  key: string;
};

type PartFilePreparation = {
  path: string;
  size: number;
};

type NativePartWriter = {
  expectedSize: number;
  size: number;
  handle: FileHandle;
};

const hasTauri = "__TAURI_INTERNALS__" in window;
let selectedSaveFolder: string | undefined;
const partWriters = new Map<string, NativePartWriter>();

async function closePartWriter(transferId: string): Promise<void> {
  const writer = partWriters.get(transferId);
  if (!writer) {
    return;
  }
  partWriters.delete(transferId);
  await writer.handle.close();
}

async function getPartWriter(transferId: string, expectedSize: number): Promise<NativePartWriter> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error("Invalid expected transfer size.");
  }

  const existing = partWriters.get(transferId);
  if (existing?.expectedSize === expectedSize) {
    return existing;
  }
  if (existing) {
    await closePartWriter(transferId);
  }

  const preparation = await invoke<PartFilePreparation>("prepare_part_file", {
    transferId,
    expectedSize,
    saveFolder: selectedSaveFolder
  });
  const handle = await openNativeFile(preparation.path, {
    append: true,
    create: true,
    write: true
  });
  const writer = {
    expectedSize,
    size: preparation.size,
    handle
  } satisfies NativePartWriter;
  partWriters.set(transferId, writer);
  return writer;
}

export const platformAdapter = {
  setSaveFolder(saveFolder: string | undefined): void {
    selectedSaveFolder = saveFolder?.trim() || undefined;
  },

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

  async createNativeBinarySource(path: string, size: number): Promise<NativeBinaryFileSource> {
    if (!hasTauri) {
      throw new Error("Native file reads are only available in Tauri.");
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Invalid source file size.");
    }

    const scopedPath = await invoke<string>("grant_file_read_access", { path });
    const handle = await openNativeFile(scopedPath, { read: true });
    let currentOffset = 0;
    let closed = false;

    return {
      size,
      nativePath: scopedPath,
      async readChunk(offset: number, length: number): Promise<ArrayBuffer> {
        if (closed) {
          throw new Error("Native source file is already closed.");
        }
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > size) {
          throw new Error("Invalid native file read range.");
        }
        const boundedLength = Math.min(length, size - offset);
        if (boundedLength === 0) {
          return new ArrayBuffer(0);
        }
        if (offset !== currentOffset) {
          await handle.seek(offset, SeekMode.Start);
        }

        const buffer = new Uint8Array(boundedLength);
        const bytesRead = await handle.read(buffer);
        if (bytesRead === null) {
          currentOffset = offset;
          return new ArrayBuffer(0);
        }
        currentOffset = offset + bytesRead;
        return bytesRead === buffer.byteLength ? buffer.buffer : buffer.slice(0, bytesRead).buffer;
      },
      async close(): Promise<void> {
        if (closed) {
          return;
        }
        closed = true;
        await handle.close();
      }
    };
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
    return invoke<string>("save_received_file", { filename: name, bytes: payload, saveFolder: selectedSaveFolder });
  },

  async writePartChunk(transferId: string, bytes: ArrayBuffer, expectedSize: number): Promise<number> {
    if (!hasTauri) {
      throw new Error("writePartChunk is only available in Tauri.");
    }
    const writer = await getPartWriter(transferId, expectedSize);
    if (writer.size + bytes.byteLength > expectedSize) {
      throw new Error("Received data exceeds the declared transfer size.");
    }
    const bytesWritten = await writer.handle.write(new Uint8Array(bytes));
    if (bytesWritten !== bytes.byteLength) {
      throw new Error("Native file write completed partially.");
    }
    writer.size += bytesWritten;
    return writer.size;
  },

  async getPartFileSize(transferId: string, expectedSize: number): Promise<number> {
    if (!hasTauri) {
      return 0;
    }
    const writer = await getPartWriter(transferId, expectedSize);
    return writer.size;
  },

  async inspectPartFileSize(transferId: string): Promise<number> {
    if (!hasTauri) {
      return 0;
    }
    return invoke<number>("get_part_file_size", { transferId, saveFolder: selectedSaveFolder });
  },

  async prepareNativeReceive(input: NativeReceiveInput): Promise<number> {
    if (!hasTauri) {
      throw new Error("Native transfer is only available in Tauri.");
    }
    const preparation = await invoke<{ size: number }>("prepare_native_receive", {
      ...input,
      saveFolder: selectedSaveFolder
    });
    return preparation.size;
  },

  async cancelNativeReceive(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await invoke<void>("cancel_native_receive", { transferId });
  },

  async cancelNativeSend(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await invoke<void>("cancel_native_send", { transferId });
  },

  async pauseNativeSend(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await invoke<void>("pause_native_send", { transferId });
  },

  async resumeNativeSend(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await invoke<void>("resume_native_send", { transferId });
  },

  async sendNativeFile(input: NativeSendInput): Promise<void> {
    if (!hasTauri) {
      throw new Error("Native transfer is only available in Tauri.");
    }
    await invoke<void>("send_native_file", input);
  },

  async finalizePartFile(transferId: string, filename: string, expectedSize: number, sha256?: string): Promise<string> {
    if (!hasTauri) {
      throw new Error("finalizePartFile is only available in Tauri.");
    }
    await closePartWriter(transferId);
    return invoke<string>("finalize_part_file", {
      transferId,
      filename,
      expectedSize,
      sha256,
      saveFolder: selectedSaveFolder
    });
  },

  async deletePartFile(transferId: string): Promise<void> {
    if (!hasTauri) {
      return;
    }
    await closePartWriter(transferId);
    await invoke<void>("delete_part_file", { transferId, saveFolder: selectedSaveFolder });
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
