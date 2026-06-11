import { CloudUpload } from "lucide-react";

type DropOverlayProps = {
  visible: boolean;
};

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="absolute inset-4 z-20 grid place-items-center rounded-[14px] border border-dashed border-blue-300 bg-white/90 shadow-card backdrop-blur-sm">
      <div className="text-center">
        <CloudUpload className="mx-auto h-10 w-10 text-slate-500" />
        <div className="mt-4 text-[13px] font-medium text-text">ここにファイルをドロップ</div>
        <div className="mt-1 text-[11px] text-muted">またはクリックして選択</div>
      </div>
    </div>
  );
}
