import { CloudUpload } from "lucide-react";

type DropOverlayProps = {
  visible: boolean;
};

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="absolute inset-4 z-20 grid place-items-center rounded-[16px] border border-dashed border-blue-300 bg-white/92 shadow-[0_24px_70px_rgba(16,24,40,0.14)] backdrop-blur-sm">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-border bg-white shadow-card">
          <CloudUpload className="h-7 w-7 text-muted" />
        </div>
        <div className="mt-4 text-[13px] font-semibold text-text">ここにファイルをドロップ</div>
        <div className="mt-1 text-[11px] text-muted">またはクリックして選択</div>
      </div>
    </div>
  );
}
