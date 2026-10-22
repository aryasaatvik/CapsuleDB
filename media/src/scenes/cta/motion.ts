import type { SceneMotion } from "../../scene";
import { ease, lift, one, rise } from "../motion-kit";

/** 0.0 the mark seals. 0.5 wordmark. 1.1 install line. 1.6 repository. 2.1 footer. Holds to 5.0. */
export const cta: SceneMotion = (tl, root) => {
  tl.fromTo(
    one(root, "mark-host"),
    { x: -18, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.6, ease: ease.out },
    0,
  );
  tl.fromTo(
    one(root, "mark-package"),
    { x: 22, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.6, ease: ease.snap },
    0.1,
  );
  lift(tl, one(root, "wordmark"), 0.5, { duration: 0.8 });
  rise(tl, one(root, "install"), 1.1, { y: 20, duration: 0.6 });
  rise(tl, one(root, "repo"), 1.6, { y: 16, duration: 0.5 });
  rise(tl, one(root, "footer"), 2.1, { y: 12, duration: 0.5 });
  tl.set({}, {}, 5);
};
