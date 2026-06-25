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
      <main className="flex h-full min-h-0 w-full max-w-full items-center justify-center overflow-hidden bg-transparent p-1">
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
    <main className="grid h-full min-h-0 w-full max-w-full place-items-stretch overflow-hidden bg-bg p-0">
      <section className="kuno-shell-expand relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg text-text">
        {children}
      </section>
    </main>
  );
}
