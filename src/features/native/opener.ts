import { platformAdapter } from "./platformAdapter";

export async function openLocalPath(path?: string) {
  if (path) {
    await platformAdapter.openPath(path);
  }
}

export async function revealLocalPath(path?: string) {
  if (path) {
    await platformAdapter.revealPath(path);
  }
}
