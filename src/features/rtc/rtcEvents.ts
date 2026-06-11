export type RtcEvent =
  | { type: "control:open" }
  | { type: "binary:open" }
  | { type: "peer:connected" }
  | { type: "peer:disconnected" }
  | { type: "peer:failed"; reason: string };
