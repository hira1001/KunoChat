import { describe, expect, test } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";

const mainWindow = tauriConfig.app.windows[0];

describe("native window configuration", () => {
  test("uses OS window decorations", () => {
    expect(mainWindow.decorations).toBe(true);
  });

  test("is not transparent", () => {
    expect(mainWindow.transparent).toBe(false);
  });

  test("is resizable", () => {
    expect(mainWindow.resizable).toBe(true);
  });

  test("uses the compact default width", () => {
    expect(mainWindow.width).toBe(360);
  });

  test("uses the compact default height", () => {
    expect(mainWindow.height).toBe(560);
  });

  test("keeps mobile-safe minimum width", () => {
    expect(mainWindow.minWidth).toBeLessThanOrEqual(320);
  });

  test("keeps usable minimum height", () => {
    expect(mainWindow.minHeight).toBeLessThanOrEqual(420);
  });

  test("does not force always-on-top by default", () => {
    expect(mainWindow.alwaysOnTop).toBe(false);
  });
});
