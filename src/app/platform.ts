export type DesktopPlatform = "windows" | "macos";

export const platformShortcuts: Record<DesktopPlatform, string> = {
  windows: "Ctrl + Shift + Space",
  macos: "Cmd + Shift + Space"
};

export const revealLabels: Record<DesktopPlatform, string> = {
  windows: "Show in Explorer",
  macos: "Reveal in Finder"
};
