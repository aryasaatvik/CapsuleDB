import type { SceneMotion } from "../scene";
import { anatomy } from "./anatomy/motion";
import { anatomyStill } from "./anatomy-still/motion";
import { compose } from "./compose/motion";
import { cta } from "./cta/motion";
import { hook } from "./hook/motion";
import { prepare } from "./prepare/motion";
import { readinessStill } from "./readiness-still/motion";
import { reveal } from "./reveal/motion";
import { sharedStill } from "./shared-still/motion";
import { social } from "./social/motion";
import { use } from "./use/motion";

/** Runtime entry: every scene's motion, keyed by scene id. `markup.tsx` renders their markup. */
export const motions: Record<string, SceneMotion> = {
  hook,
  reveal,
  anatomy,
  compose,
  prepare,
  use,
  cta,
  "anatomy-still": anatomyStill,
  "shared-still": sharedStill,
  "readiness-still": readinessStill,
  social,
};
