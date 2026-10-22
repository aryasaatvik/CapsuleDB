import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { filmFile } from "../src/cuts";
import { app, exportsDir, run } from "./projects";

/** Review points in the rendered film: every beat's settled state and each cut between beats. */
export const checkpoints = [
  [1.5, "hook-need"],
  [5.6, "hook-split"],
  [6.8, "cut-hook-reveal"],
  [7.3, "reveal-seal"],
  [10.6, "reveal-settled"],
  [12.4, "cut-reveal-anatomy"],
  [15.6, "anatomy-tables"],
  [17.8, "anatomy-migrations"],
  [20.0, "anatomy-service"],
  [22.6, "anatomy-identity"],
  [23.8, "cut-anatomy-compose"],
  [27.8, "compose-registry"],
  [30.5, "compose-client"],
  [34.5, "compose-database"],
  [35.8, "cut-compose-prepare"],
  [41.6, "prepare-apply"],
  [44.4, "prepare-provide"],
  [46.9, "prepare-asides"],
  [48.4, "cut-prepare-use"],
  [53.2, "use-replay"],
  [54.4, "use-operations"],
  [55.3, "cut-use-cta"],
  [57.5, "cta-settled"],
  [59.9, "cta-last"],
] as const;

const dir = join(app, ".build/review");
await mkdir(dir, { recursive: true });
const files = await Promise.all(
  checkpoints.map(async ([time, id]) => {
    const file = join(dir, `${time.toFixed(1).padStart(4, "0")}-${id}.png`);
    await run([
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      join(exportsDir, filmFile),
      "-frames:v",
      "1",
      file,
    ]);
    return file;
  }),
);
const columns = 4;
const cells = checkpoints.map(
  (_, index) => `[${index}:v]scale=480:270,pad=480:300:0:0:color=0xf1eee6[v${index}]`,
);
const layout = checkpoints
  .map((_, index) => `${(index % columns) * 480}_${Math.floor(index / columns) * 300}`)
  .join("|");
const graph = `${cells.join(";")};${checkpoints.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=0xf1eee6[out]`;
await run([
  "ffmpeg",
  "-y",
  "-v",
  "error",
  ...files.flatMap((file) => ["-i", file]),
  "-filter_complex",
  graph,
  "-map",
  "[out]",
  "-frames:v",
  "1",
  join(dir, "contact-sheet.png"),
]);
console.log(`MP4 frames and contact sheet: ${dir}`);
