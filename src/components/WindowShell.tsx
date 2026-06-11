import clsx from "clsx";
import type { ReactNode } from "react";
import type { AppView, ConnectionStatus } from "../features/chat/messageTypes";
import { MiniPill } from "./MiniPill";

type WindowShellProps = {
  mode: AppView;
  connectionState: ConnectionStatus;
  unreadCount: number;
  activeTransferCount: number;
  onOpenMain: () => void;
  children: ReactNode;
};

export function WindowShell({
  mode,
  connectionState,
  unreadCount,
  activeTransferCount,
  onOpenMain,
  children
}: WindowShellProps) {
  if (mode === "mini") {
    return (
      <main className="grid min-h-screen place-items-start justify-end p-2 sm:p-6">
        <MiniPill
          status={connectionState}
          unreadCount={unreadCount}
          activeTransferCount={activeTransferCount}
          onOpen={onOpenMain}
        />
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-start justify-end p-0 sm:p-6">
      <section
        className={clsx(
          "relative flex h-screen max-h-[560px] w-screen max-w-[360px] overflow-hidden rounded-window border border-border bg-bg shadow-window",
          "sm:h-[min(560px,calc(100vh-48px))] sm:w-[min(360px,calc(100vw-48px))]",
          "transition duration-150"
        )}
      >
        {children}
        <FrameDragRegions />
      </section>
    </main>
  );
}

function FrameDragRegions() {
  return (
    <>
      <div aria-hidden="true" data-tauri-drag-region className="absolute bottom-0 left-0 top-0 z-30 w-2" />
      <div aria-hidden="true" data-tauri-drag-region className="absolute bottom-0 right-0 top-0 z-30 w-2" />
      <div aria-hidden="true" data-tauri-drag-region className="absolute bottom-0 left-0 right-0 z-30 h-2" />
    </>
  );
}
