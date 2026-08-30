import { assert, describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

describe("packed exports", () => {
  it("resolves only the declared public package entrypoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-packed-"));
    try {
      const { stdout } = await execFileAsync(
        "npm",
        ["pack", "--json", "--pack-destination", directory],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const packed = JSON.parse(stdout) as ReadonlyArray<{ filename?: string }>;
      const filename = packed[0]?.filename;
      if (filename === undefined) throw new Error("npm pack returned no filename");

      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "capsuledb-packed-consumer",
          private: true,
          type: "module",
          dependencies: { effect: "4.0.0-rc.111" },
        }),
      );
      await execFileAsync(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, filename)],
        { cwd: directory, encoding: "utf8" },
      );
      await writeFile(
        join(directory, "consumer.mjs"),
        `
import { VERSION } from "capsuledb";
import { D1 as D1Subpath } from "capsuledb/D1";
import { Libsql as LibsqlSubpath } from "capsuledb/Libsql";
import { Pg as PgSubpath } from "capsuledb/Pg";
import { D1, Libsql, Pg } from "capsuledb";
import packageJson from "capsuledb/package.json" with { type: "json" };

if (VERSION !== packageJson.version || VERSION !== ${JSON.stringify(packageJson.version)}) {
  throw new Error("Packed public export does not match package metadata");
}

const providerProfiles = [
  [D1, D1Subpath, "D1"],
  [Pg, PgSubpath, "Postgres"],
  [Libsql, LibsqlSubpath, "Libsql"],
];
for (const [rootProvider, subpathProvider, dialect] of providerProfiles) {
  if (rootProvider.profile.dialect._tag !== dialect || subpathProvider.profile.dialect._tag !== dialect) {
    throw new Error("Packed provider profile mismatch for " + dialect);
  }
}

try {
  await import("capsuledb/src/index.js");
  throw new Error("Private source import unexpectedly resolved");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    throw error;
  }
}
`,
      );
      await execFileAsync("node", [join(directory, "consumer.mjs")], {
        cwd: directory,
        encoding: "utf8",
      });
      assert.strictEqual(packageJson.name, "capsuledb");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 60_000);
});
