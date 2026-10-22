import type { SceneMotion } from "../../scene";
import { all, draw, ease, exit, lift, nth, one, rise } from "../motion-kit";

/** Seconds at which the marker reaches each station. */
const arrivals = [1.7, 3.1, 4.7, 6.3, 7.6] as const;
const stride = 350;

/**
 * 0.0 header. 0.3 headline. 1.3 the track draws. The marker visits each station in turn: read,
 * pending (two migrations), apply (both check off), Ready, then the service. 9.0 asides. 11.5 exit.
 */
export const prepare: SceneMotion = (tl, root) => {
  rise(tl, one(root, "header"), 0, { y: -12, duration: 0.5 });
  lift(tl, all(root, "title"), 0.3, { stagger: 0.18 });
  draw(tl, one(root, "track"), 1.2, { duration: 1.0 });
  rise(tl, one(root, "marker"), 1.3, { y: 0, x: -20, duration: 0.4 });

  arrivals.forEach((at, index) => {
    if (index > 0)
      tl.to(one(root, "marker"), { x: index * stride, duration: 0.6, ease: ease.inOut }, at - 0.6);
    rise(tl, nth(root, "station", index), at, { y: 22, duration: 0.55 });
  });

  rise(tl, all(root, "pending"), arrivals[1] + 0.3, { x: -14, y: 0, duration: 0.4, stagger: 0.25 });
  tl.set(all(root, "applied"), { autoAlpha: 0 }, 0);
  tl.fromTo(
    all(root, "applied"),
    { autoAlpha: 0, scale: 0.4 },
    { autoAlpha: 1, scale: 1, duration: 0.35, ease: ease.snap, stagger: 0.45 },
    arrivals[2] + 0.4,
  );
  tl.fromTo(
    one(root, "ready"),
    { scale: 0.6 },
    { scale: 1, duration: 0.45, ease: ease.snap },
    arrivals[3] + 0.1,
  );
  tl.fromTo(
    one(root, "service"),
    { x: -40 },
    { x: 0, duration: 0.6, ease: ease.snap },
    arrivals[4] + 0.05,
  );
  rise(tl, all(root, "aside"), 9.0, { y: 16, duration: 0.55, stagger: 0.4 });
  exit(tl, root, 11.5);
};
