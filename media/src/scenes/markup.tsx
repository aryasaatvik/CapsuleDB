import type { SceneMarkup } from "../scene";
import { anatomy } from "./anatomy/markup";
import { anatomyStill } from "./anatomy-still/markup";
import { compose } from "./compose/markup";
import { cta } from "./cta/markup";
import { hook } from "./hook/markup";
import { prepare } from "./prepare/markup";
import { readinessStill } from "./readiness-still/markup";
import { reveal } from "./reveal/markup";
import { sharedStill } from "./shared-still/markup";
import { social } from "./social/markup";
import { use } from "./use/markup";

/** Build-time entry: every scene's markup, keyed by scene id. `motion.ts` holds their motion. */
export const markups: Record<string, SceneMarkup> = {
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
