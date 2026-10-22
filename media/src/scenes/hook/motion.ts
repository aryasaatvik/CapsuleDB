import type { SceneMotion } from "../../scene";
import { all, draw, exit, lift, one, rise } from "../motion-kit";

/**
 * 0.2 kicker. 0.4 the need lands. 1.8 the owner answers it. 3.4 a seal bar draws. 3.8-4.4 the split:
 * the package brings its tables and borrows the host's client. 6.5 exit.
 */
export const hook: SceneMotion = (tl, root) => {
  rise(tl, one(root, "kicker"), 0.2, { y: 12, duration: 0.5 });
  lift(tl, one(root, "need"), 0.4, { duration: 0.9 });
  lift(tl, one(root, "own"), 1.8, { duration: 0.9 });
  draw(tl, one(root, "bar"), 3.4, { duration: 0.5 });
  lift(tl, all(root, "split"), 3.8, { duration: 0.8, stagger: 0.7 });
  exit(tl, root, 6.5);
};
