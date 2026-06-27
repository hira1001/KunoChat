import type { SignalMessage } from "./signalTypes";

export function routeSignalMessage(message: SignalMessage): SignalMessage["type"] {
  return message.type;
}
