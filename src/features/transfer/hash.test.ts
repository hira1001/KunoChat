import { describe, expect, test, vi } from "vitest";
import { sha256ArrayBuffer, sha256ForAsset } from "./hash";
import { platformAdapter } from "../native/platformAdapter";

describe("sha256ArrayBuffer", () => {
  test("hashes empty payload", async () => {
    await expect(sha256ArrayBuffer(new Uint8Array([]).buffer)).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  test("hashes text payload", async () => {
    await expect(sha256ArrayBuffer(new TextEncoder().encode("KunoChat").buffer)).resolves.toBe(
      "28baa14c77d05bb336e02e23e843b8ef9a2ad7514481ec1d16226f56ccc79b02"
    );
  });
});

describe("sha256ForAsset", () => {
  test("uses native hashing for local paths", async () => {
    const spy = vi.spyOn(platformAdapter, "fileSha256").mockResolvedValue("native-hash");
    await expect(sha256ForAsset({ localPath: "/tmp/file.pdf" })).resolves.toBe("native-hash");
    expect(spy).toHaveBeenCalledWith("/tmp/file.pdf");
    spy.mockRestore();
  });

  test("uses browser hashing for File payloads", async () => {
    const result = await sha256ForAsset({ file: new File(["KunoChat"], "kuno.txt") });
    expect(result).toBe("28baa14c77d05bb336e02e23e843b8ef9a2ad7514481ec1d16226f56ccc79b02");
  });

  test("returns undefined when no readable source exists", async () => {
    await expect(sha256ForAsset({})).resolves.toBeUndefined();
  });
});
