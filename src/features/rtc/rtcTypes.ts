export type DataChannelName = "control" | "binary";

export type RtcChannelState = "idle" | "connecting" | "open" | "closing" | "closed" | "failed";

export type RtcConnectionState = {
  peer: RtcChannelState;
  channels: Record<DataChannelName, RtcChannelState>;
};

export type RtcChannelPolicy = {
  name: DataChannelName;
  ordered: boolean;
  maxRetransmits?: number;
  purpose: string;
};

export const RTC_CHANNEL_POLICIES: RtcChannelPolicy[] = [
  {
    name: "control",
    ordered: true,
    purpose: "instant text, metadata, ACK, cancel, retry, progress, ping/pong"
  },
  {
    name: "binary",
    ordered: true,
    purpose: "image and file chunks only, never blocking instant control messages"
  }
];
