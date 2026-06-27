export type RuntimeConfig = {
  signalingConfigured: boolean;
  signalingUrl: string;
  iceServers: RTCIceServer[];
};

const signalingUrl = import.meta.env.VITE_SIGNALING_URL || "ws://127.0.0.1:8787";

export const runtimeConfig: RuntimeConfig = {
  signalingUrl,
  signalingConfigured: Boolean(signalingUrl),
  iceServers: [
    {
      urls: import.meta.env.VITE_STUN_URL || "stun:stun.l.google.com:19302"
    }
  ]
};
