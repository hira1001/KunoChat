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
      <main className="grid min-h-screen place-items-start justify-end bg-bg p-2 sm:p-6">
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
    <main className="grid min-h-screen place-items-stretch bg-bg p-0">
      <section className="relative flex h-screen w-screen overflow-hidden bg-bg transition duration-150">
        {children}
      </section>
    </main>
  );
}
