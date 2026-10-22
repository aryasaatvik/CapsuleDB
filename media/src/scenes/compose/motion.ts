import type { SceneMotion } from "../../scene";
import { all, draw, ease, exit, lift, one, rise } from "../motion-kit";

/**
 * 0.0 header. 0.3 headline. 1.0 the host's code. 2.0 the host frame. 3.0 the capsule plugs into
 * `Registry.layer` as its code highlights. 5.4 the host's client, as `provideService` highlights.
 * 7.4 the link and database; rows land by owner: host, capsule, ledger. 9.6 footnote. 11.5 exit.
 */
export const compose: SceneMotion = (tl, root) => {
  rise(tl, one(root, "header"), 0, { y: -12, duration: 0.5 });
  lift(tl, all(root, "title"), 0.3, { stagger: 0.18 });
  rise(tl, one(root, "code"), 1.0, { x: -40, y: 0, duration: 0.7 });
  rise(tl, all(root, "code-line"), 1.1, { y: 8, duration: 0.35, stagger: 0.04 });
  tl.set([one(root, "hi-registry"), one(root, "hi-client")], { scaleX: 0 }, 0);

  rise(tl, one(root, "host"), 2.0, { y: 24, duration: 0.6 });
  rise(tl, one(root, "registry"), 2.4, { y: 16, duration: 0.5 });
  tl.fromTo(
    one(root, "pill"),
    { x: -260, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.8, ease: ease.snap },
    3.0,
  );
  draw(tl, one(root, "hi-registry"), 3.0, { duration: 0.45 });
  rise(tl, one(root, "badge-explicit"), 3.7, { x: 20, y: 0, duration: 0.5 });

  tl.to(one(root, "hi-registry"), { autoAlpha: 0.35, duration: 0.3 }, 5.2);
  rise(tl, one(root, "client"), 5.4, { y: 20, duration: 0.6 });
  draw(tl, one(root, "hi-client"), 5.5, { duration: 0.45 });

  draw(tl, one(root, "link"), 7.4, { axis: "y", duration: 0.4 });
  rise(tl, one(root, "db"), 7.6, { y: 24, duration: 0.6 });
  rise(tl, all(root, "db-row"), 8.0, { x: -16, y: 0, duration: 0.4, stagger: 0.22 });
  rise(tl, one(root, "footnote"), 9.6, { y: 10, duration: 0.5 });
  exit(tl, root, 11.5);
};
