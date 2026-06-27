export type PairingSession = {
  pairingCode: string;
  roomId: string;
  expiresAt: number;
  createdBy: string;
};

export type PairedPeer = {
  peerId: string;
  displayName: string;
  roomId: string;
  fingerprint?: string;
  pairedAt: number;
  lastSeenAt: number;
};
