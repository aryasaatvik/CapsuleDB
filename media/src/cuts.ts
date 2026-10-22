import type { Cut, Size } from "./scene";

/** The film's beats in order. Durations are seconds and sum to the 60-second cut. */
export const beats = [
  { scene: "hook", duration: 7 },
  { scene: "reveal", duration: 5 },
  { scene: "anatomy", duration: 12 },
  { scene: "compose", duration: 12 },
  { scene: "prepare", duration: 12 },
  { scene: "use", duration: 7 },
  { scene: "cta", duration: 5 },
] as const;

let start = 0;
export const film: Cut = {
  id: "film",
  width: 1920,
  height: 1080,
  shots: beats.map((beat) => {
    const shot = { ...beat, start };
    start += beat.duration;
    return shot;
  }),
};

/** One exported image: a scene rendered at its own canvas size, then saved as `file`. */
export interface Still extends Size {
  readonly scene: string;
  readonly file: string;
}

export const stills: ReadonlyArray<Still> = [
  { scene: "anatomy-still", file: "capsule-anatomy.png", width: 1920, height: 1080 },
  { scene: "shared-still", file: "shared-database.png", width: 1920, height: 1080 },
  { scene: "readiness-still", file: "preparation-readiness.png", width: 1920, height: 1080 },
  { scene: "social", file: "og.png", width: 1200, height: 630 },
  { scene: "social", file: "github-social-preview.png", width: 1280, height: 640 },
];

/** The poster is the film's settled reveal, extracted from the rendered MP4. */
export const poster = { at: 10.6, file: "capsuledb-launch-poster.jpg" } as const;
export const filmFile = "capsuledb-launch.mp4";
