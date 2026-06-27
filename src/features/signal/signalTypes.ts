export type SignalMessage =
  | { type: "hello"; peerId: string; roomId: string }
  | { type: "offer"; peerId: string; roomId: string; sdp: string }
  | { type: "answer"; peerId: string; roomId: string; sdp: string }
  | { type: "ice"; peerId: string; roomId: string; candidate: string }
  | { type: "presence"; peerId: string; roomId: string; online: boolean }
  | { type: "leave"; peerId: string; roomId: string };

export interface SignalProvider {
  connect(roomId: string): Promise<void>;
  send(message: SignalMessage): Promise<void>;
  onMessage(handler: (message: SignalMessage) => void): () => void;
  disconnect(): Promise<void>;
}
