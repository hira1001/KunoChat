import { create } from "zustand";
import type { PairedPeer, PairingSession } from "./pairingTypes";

type PairingStore = {
  session?: PairingSession;
  peer?: PairedPeer;
  setSession: (session: PairingSession) => void;
  setPeer: (peer: PairedPeer) => void;
};

export const usePairingStore = create<PairingStore>((set) => ({
  setSession: (session) => set({ session }),
  setPeer: (peer) => set({ peer })
}));
