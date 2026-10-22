import type { SceneMotion } from "../../scene";
import { all, draw, exit, hide, lift, one, rise } from "../motion-kit";

const parts = [
  { hi: "hi-tables", fill: "c-tables-fill", note: "note-tables", at: 2.8 },
  { hi: "hi-migrations", fill: "c-migrations-fill", note: "note-migrations", at: 5.0 },
  { hi: "hi-service", fill: "c-service-fill", note: "note-service", at: 7.2 },
  { hi: "hi-id", fill: undefined, note: "note-id", at: 9.2 },
] as const;

/**
 * 0.0 header. 0.3 headline. 1.0 the code and the empty capsule arrive. From 2.8, every 2.2 seconds
 * one part of the code highlights, its compartment fills, and its note takes the slot. 11.5 exit.
 */
export const anatomy: SceneMotion = (tl, root) => {
  rise(tl, one(root, "header"), 0, { y: -12, duration: 0.5 });
  lift(tl, all(root, "title"), 0.3, { stagger: 0.18 });
  rise(tl, one(root, "sub"), 0.9, { y: 16 });
  rise(tl, one(root, "code"), 1.0, { x: 40, y: 0, duration: 0.7 });
  rise(tl, all(root, "code-line"), 1.15, { y: 8, duration: 0.35, stagger: 0.035 });
  rise(tl, one(root, "capsule"), 1.4, { y: 24, duration: 0.7 });

  for (const part of parts) {
    tl.set(one(root, part.hi), { scaleX: 0 }, 0);
    tl.set(one(root, part.note), { autoAlpha: 0 }, 0);
    if (part.fill !== undefined) tl.set(one(root, part.fill), { scaleX: 0 }, 0);
  }
  parts.forEach((part, index) => {
    draw(tl, one(root, part.hi), part.at, { duration: 0.45 });
    if (part.fill !== undefined) draw(tl, one(root, part.fill), part.at, { duration: 0.6 });
    rise(tl, one(root, part.note), part.at + 0.15, { y: 18, duration: 0.5 });
    const next = parts[index + 1];
    if (next !== undefined) {
      hide(tl, one(root, part.note), next.at - 0.25, 0.25);
      tl.to(one(root, part.hi), { autoAlpha: 0, duration: 0.3 }, next.at - 0.1);
    }
  });
  exit(tl, root, 11.5);
};
