import { platformAdapter } from "./platformAdapter";

export async function notifyFileReceived(filename: string, size: number) {
  await platformAdapter.showNotification({
    title: "KunoChat received a file",
    body: `${filename} · ${size} bytes`
  });
}
