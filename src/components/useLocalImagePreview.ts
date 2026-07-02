import { useEffect, useState } from "react";
import { platformAdapter } from "../features/native/platformAdapter";

const maxPreviewBytes = 30 * 1024 * 1024;

export function useLocalImagePreview(path: string | undefined, mime: string | undefined, enabled = true): string | undefined {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    setPreviewUrl(undefined);
    if (!enabled || !path || !mime?.startsWith("image/")) {
      return undefined;
    }

    void platformAdapter.createImagePreviewUrl(path, mime, maxPreviewBytes).then((url) => {
      if (cancelled) {
        if (url) {
          URL.revokeObjectURL(url);
        }
        return;
      }
      objectUrl = url;
      setPreviewUrl(url);
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [enabled, mime, path]);

  return previewUrl;
}
