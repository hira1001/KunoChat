import { CloudUpload } from "lucide-react";

type DropOverlayProps = {
  visible: boolean;
};

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="ドロップゾーン"
      className="absolute inset-3 z-20 grid place-items-center overflow-hidden rounded-card border-2 border-dashed border-accent bg-bg-glass shadow-window backdrop-blur-[20px] kuno-fade-in kuno-drop-border"
    >
      {/* Animated glow ring */}
      <div className="pointer-events-none absolute inset-0 rounded-card bg-accent/5" />

      <div className="text-center">
        {/* Icon container with pulse */}
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-accent/10">
          <CloudUpload className="h-8 w-8 text-accent" />
        </div>
        <div className="mt-4 text-[14px] font-semibold tracking-[-0.02em] text-text">
          ここにファイルをドロップ
        </div>
        <div className="mt-1 text-[12px] text-muted">複数ファイルも一度に送れます</div>
      </div>
    </div>
  );
}
