import { describe, expect, test, vi } from "vitest";
import { detectAttachmentKind, detectTextKind } from "./detectSendable";
import { parseClipboardItems } from "./clipboardParser";
import { parseDroppedFiles } from "./dropParser";

function file(name: string, type: string, body = "x") {
  return new File([body], name, { type });
}

describe("detectTextKind", () => {
  test.each([
    ["https://example.com", "link"],
    ["http://localhost:1420", "link"],
    ["  https://kuno.chat/path?q=1  ", "link"],
    ["ftp://example.com", "text"],
    ["not a url", "text"],
    ["hello\nworld", "text"],
    ["const value = 1;\nconsole.log(value);", "code"],
    ["function run() {\nreturn true;\n}", "code"],
    ["body { color: red; }", "text"],
    ["plain braces {}", "text"],
    ["mailto:test@example.com", "text"],
    ["https://例.jp", "link"],
    ["line1\nline2();", "code"],
    ["", "text"]
  ] as const)("detects %s as %s", (input, expected) => {
    expect(detectTextKind(input)).toBe(expected);
  });
});

describe("detectAttachmentKind", () => {
  test.each([
    [file("a.png", "image/png"), "image"],
    [file("a.jpg", "image/jpeg"), "image"],
    [file("a.webp", "image/webp"), "image"],
    [file("a.pdf", "application/pdf"), "file"],
    [file("a.zip", "application/zip"), "file"],
    [file("a", ""), "file"]
  ] as const)("detects attachment kind", (input, expected) => {
    expect(detectAttachmentKind(input)).toBe(expected);
  });
});

describe("parseDroppedFiles", () => {
  test("returns one draft attachment per dropped file", () => {
    expect(parseDroppedFiles([file("a.png", "image/png"), file("b.pdf", "application/pdf")])).toHaveLength(2);
  });

  test("marks images as image attachments", () => {
    expect(parseDroppedFiles([file("a.png", "image/png")])[0].kind).toBe("image");
  });

  test("marks non-images as file attachments", () => {
    expect(parseDroppedFiles([file("a.pdf", "application/pdf")])[0].kind).toBe("file");
  });

  test("keeps file name, size, and mime", () => {
    const parsed = parseDroppedFiles([file("a.txt", "text/plain", "hello")])[0];
    expect(parsed).toMatchObject({ name: "a.txt", size: 5, mime: "text/plain" });
  });

  test("uses octet-stream when mime is missing", () => {
    expect(parseDroppedFiles([file("a.bin", "")])[0].mime).toBe("application/octet-stream");
  });

  test("creates previews only for images", () => {
    const parsed = parseDroppedFiles([file("a.png", "image/png"), file("b.pdf", "application/pdf")]);
    expect(parsed[0].previewUrl).toBe("blob:kunochat-test");
    expect(parsed[1].previewUrl).toBeUndefined();
  });

  test("keeps the original File object", () => {
    const input = file("a.png", "image/png");
    expect(parseDroppedFiles([input])[0].file).toBe(input);
  });

  test("creates stable drop id prefix", () => {
    expect(parseDroppedFiles([file("a.png", "image/png")])[0].id).toMatch(/^drop_/);
  });
});

describe("parseClipboardItems", () => {
  function item(input: File | null, kind = "file") {
    return {
      kind,
      getAsFile: vi.fn(() => input)
    };
  }

  test("ignores non-file clipboard items", () => {
    expect(parseClipboardItems([item(file("a.txt", "text/plain"), "string")] as unknown as DataTransferItemList)).toHaveLength(0);
  });

  test("ignores null file payloads", () => {
    expect(parseClipboardItems([item(null)] as unknown as DataTransferItemList)).toHaveLength(0);
  });

  test("parses file clipboard items", () => {
    expect(parseClipboardItems([item(file("a.txt", "text/plain"))] as unknown as DataTransferItemList)).toHaveLength(1);
  });

  test("marks pasted images as image attachments", () => {
    expect(parseClipboardItems([item(file("a.png", "image/png"))] as unknown as DataTransferItemList)[0].kind).toBe("image");
  });

  test("marks pasted documents as file attachments", () => {
    expect(parseClipboardItems([item(file("a.pdf", "application/pdf"))] as unknown as DataTransferItemList)[0].kind).toBe("file");
  });

  test("creates fallback screenshot name when clipboard file is unnamed", () => {
    const parsed = parseClipboardItems([item(file("", "image/png"))] as unknown as DataTransferItemList)[0];
    expect(parsed.name).toMatch(/^Screenshot \d{2}-\d{2}\.png$/);
  });

  test("creates previews only for pasted images", () => {
    const parsed = parseClipboardItems([item(file("a.png", "image/png")), item(file("b.pdf", "application/pdf"))] as unknown as DataTransferItemList);
    expect(parsed[0].previewUrl).toBe("blob:kunochat-test");
    expect(parsed[1].previewUrl).toBeUndefined();
  });

  test("creates stable paste id prefix", () => {
    expect(parseClipboardItems([item(file("a.png", "image/png"))] as unknown as DataTransferItemList)[0].id).toMatch(/^paste_/);
  });
});
