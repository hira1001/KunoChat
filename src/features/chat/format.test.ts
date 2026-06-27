import { describe, expect, test } from "vitest";
import { fileLabel, formatBytes } from "./format";

describe("formatBytes", () => {
  test.each([
    [0, "0 B"],
    [1, "1 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024, "10 KB"],
    [1024 * 1024, "1.0 MB"],
    [12 * 1024 * 1024, "12 MB"],
    [1024 ** 3, "1.0 GB"],
    [5 * 1024 ** 3, "5.0 GB"]
  ])("formats %i bytes as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe("fileLabel", () => {
  test.each([
    ["photo.png", "image/png", "IMG"],
    ["photo.jpeg", "image/jpeg", "IMG"],
    ["proposal.pdf", "application/pdf", "PDF"],
    ["brief.docx", undefined, "DOC"],
    ["sheet.xlsx", undefined, "XLS"],
    ["deck.pptx", undefined, "PPT"],
    ["archive.zip", undefined, "ZIP"],
    ["main.ts", undefined, "CODE"],
    ["server.js", undefined, "CODE"],
    ["script.py", undefined, "CODE"],
    ["index.html", undefined, "CODE"],
    ["styles.css", undefined, "CODE"],
    ["lib.rs", undefined, "CODE"],
    ["readme.md", undefined, "CODE"],
    ["clip.mp4", undefined, "MP4"],
    ["movie.mov", undefined, "MOV"],
    ["sound.mp3", undefined, "AUD"],
    ["voice.wav", undefined, "AUD"],
    ["unknown.longext", undefined, "LONGE"],
    ["noextension", undefined, "NOEXT"]
  ])("labels %s as %s", (name, mime, expected) => {
    expect(fileLabel(name, mime)).toBe(expected);
  });
});
