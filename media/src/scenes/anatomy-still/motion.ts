import type { SceneMotion } from "../../scene";
import { STILL_SETTLE } from "../motion-kit";

/** Infographics hold their final layout; the timeline only spans the settle. */
export const anatomyStill: SceneMotion = (tl) => {
  tl.set({}, {}, STILL_SETTLE);
};
