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

  test("has a practical default width", () => {
    expect(mainWindow.width).toBeGreaterThanOrEqual(420);
  });

  test("has a practical default height", () => {
    expect(mainWindow.height).toBeGreaterThanOrEqual(640);
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
