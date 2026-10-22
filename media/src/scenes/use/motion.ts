import type { SceneMotion } from "../../scene";
import { all, ease, exit, lift, nth, one, rise } from "../motion-kit";

/**
 * 0.0 header. 0.3 headline. 0.9 the panel. From 1.3 one call per 0.85 seconds, each result
 * snapping in 0.4 later; the replayed consume fails with its typed error. 5.3 the four operations.
 * 6.6 exit.
 */
export const use: SceneMotion = (tl, root) => {
  rise(tl, one(root, "header"), 0, { y: -12, duration: 0.5 });
  lift(tl, all(root, "title"), 0.3, { stagger: 0.18 });
  rise(tl, one(root, "code"), 0.9, { y: 24, duration: 0.6 });
  const lines = all(root, "use-line");
  lines.forEach((line, index) => {
    rise(tl, line, 1.3 + index * 0.85, { x: -18, y: 0, duration: 0.4 });
  });
  all(root, "result").forEach((result, index) => {
    tl.fromTo(
      result,
      { autoAlpha: 0, x: -24 },
      { autoAlpha: 1, x: 0, duration: 0.45, ease: ease.snap },
      1.3 + (index + 1) * 0.85 + 0.4,
    );
  });
  const replay = nth(root, "result", 3);
  tl.fromTo(
    replay,
    { x: 0 },
    { x: 10, duration: 0.06, repeat: 5, yoyo: true, ease: ease.linear },
    5.0,
  );
  rise(tl, one(root, "ops"), 5.3, { y: 14, duration: 0.5 });
  exit(tl, root, 6.6);
};
