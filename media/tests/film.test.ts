import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../scripts/projects";
import { beats, film, stills } from "../src/cuts";
import { markups } from "../src/scenes/markup";
import { motions } from "../src/scenes/motion";

describe("film and stills", () => {
  test("the film is exactly 60 seconds of contiguous shots", () => {
    expect(beats.reduce((total, beat) => total + beat.duration, 0)).toBe(60);
    film.shots.forEach((shot, index) => {
      const previous = film.shots[index - 1];
      expect(shot.start).toBe(previous === undefined ? 0 : previous.start + previous.duration);
    });
  });

  test("every scene has markup and motion", () => {
    const scenes = new Set([
      ...beats.map((beat) => beat.scene),
      ...stills.map((still) => still.scene),
    ]);
    for (const scene of scenes) {
      expect(markups[scene]).toBeDefined();
      expect(motions[scene]).toBeDefined();
    }
    expect(Object.keys(markups).sort()).toEqual(Object.keys(motions).sort());
  });

  test("cards render at their distribution sizes", () => {
    const sizes = Object.fromEntries(
      stills.map((still) => [still.file, `${still.width}x${still.height}`]),
    );
    expect(sizes["og.png"]).toBe("1200x630");
    expect(sizes["github-social-preview.png"]).toBe("1280x640");
  });
});

/** Motion must be a pure function of the seeked timeline. */
describe("determinism", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const sources = files(join(app, "src"));

  test("no clocks, timers, randomness, or frame callbacks in scene code", () => {
    const forbidden =
      /\b(?:setTimeout|setInterval|requestAnimationFrame|Date\.now|new Date|Math\.random|performance\.now)\b/;
    for (const file of sources.filter((path) => /\.tsx?$/.test(path))) {
      expect({ file, match: forbidden.exec(readFileSync(file, "utf8"))?.[0] }).toEqual({
        file,
        match: undefined,
      });
    }
  });

  test("no CSS transitions or animations", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect({
        file,
        css: /(?:^|[;{\s"'])(?:transition|animation)(?:-[a-z-]+)?\s*:/m.test(text),
      }).toEqual({ file, css: false });
    }
  });
});
