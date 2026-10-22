import type { SceneMotion } from "../../scene";
import { all, ease, exit, lift, one, rise } from "../motion-kit";

/**
 * 0.0-0.7 the host half and the package half slide together and seal. 0.6 the wordmark rises.
 * 1.4 the two-line promise. 2.4 the footer. Settled from 3.2 (the poster frame). 4.6 exit.
 */
export const reveal: SceneMotion = (tl, root) => {
  tl.fromTo(
    one(root, "mark-host"),
    { x: -22, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.7, ease: ease.out },
    0,
  );
  tl.fromTo(
    one(root, "mark-package"),
    { x: 26, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.7, ease: ease.snap },
    0.1,
  );
  lift(tl, one(root, "wordmark"), 0.6, { duration: 0.9 });
  lift(tl, all(root, "tagline"), 1.4, { duration: 0.9, stagger: 0.35 });
  rise(tl, one(root, "footer"), 2.4, { y: 14, duration: 0.6 });
  exit(tl, root, 4.6);
};
