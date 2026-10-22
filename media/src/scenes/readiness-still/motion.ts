import type { SceneMotion } from "../../scene";
import { STILL_SETTLE } from "../motion-kit";

export const readinessStill: SceneMotion = (tl) => {
  tl.set({}, {}, STILL_SETTLE);
};
