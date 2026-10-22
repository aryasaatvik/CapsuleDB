import type { SceneMotion } from "../../scene";
import { STILL_SETTLE } from "../motion-kit";

export const sharedStill: SceneMotion = (tl) => {
  tl.set({}, {}, STILL_SETTLE);
};
