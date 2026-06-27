export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

export function fileLabel(name: string, mime?: string): string {
  const extension = name.split(".").pop()?.toUpperCase() || "FILE";
  if (mime?.startsWith("image/")) {
    return "IMG";
  }

  if (["PDF", "DOC", "DOCX", "XLS", "XLSX", "PPT", "PPTX", "ZIP"].includes(extension)) {
    return extension.replace("DOCX", "DOC").replace("XLSX", "XLS").replace("PPTX", "PPT");
  }

  if (["JS", "TS", "PY", "HTML", "CSS", "RS", "MD"].includes(extension)) {
    return "CODE";
  }

  if (["MP4", "MOV", "WEBM"].includes(extension)) {
    return extension;
  }

  if (["MP3", "WAV", "M4A"].includes(extension)) {
    return "AUD";
  }

  return extension.slice(0, 5);
}
