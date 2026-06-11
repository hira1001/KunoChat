import { platformAdapter } from "../features/native/platformAdapter";

export async function bootstrap() {
  await platformAdapter.positionTopRight();
}
