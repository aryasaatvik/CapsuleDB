import { assert, describe, it } from "@effect/vitest";
import { Miniflare } from "miniflare";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const effectVersion = "4.0.0-rc.112";

const fixtureModule = `
import { Context, Effect, Layer } from "effect";
import { makeCapsule, makeMigration, sqlMigrationBody } from "capsuledb";

export const ReferenceService = Context.Service("packed/ReferenceService");

const migration = await Effect.runPromise(
  makeMigration({
    id: 1,
    name: "create-packed-table",
    risk: "additive",
    providers: {
      D1: sqlMigrationBody(
        'CREATE TABLE "packed_table" (value TEXT NOT NULL)',
        ['CREATE TABLE "packed_table" (value TEXT NOT NULL)'],
      ),
    },
  }),
);

export const capsule = await Effect.runPromise(
  makeCapsule({
    id: "packed.reference",
    migrations: [migration],
    layer: Layer.succeed(ReferenceService, { value: "packed-service" }),
  }),
);
`;

const consumerModule = `
import { Effect } from "effect";
import {
  D1,
  buildD1Artifact,
  buildManifest,
  makeRegistry,
  manifestPlan,
  VERSION,
} from "capsuledb";
import { capsule, ReferenceService } from "./capsule.mjs";

const manifest = await Effect.runPromise(buildManifest({ capsules: [capsule] }));
const registry = await Effect.runPromise(makeRegistry({ provider: D1.profile, capsules: [capsule] }));
const registryPlan = await Effect.runPromise(manifestPlan(registry));
const artifact = await Effect.runPromise(buildD1Artifact(manifest));
const service = await Effect.runPromise(
  Effect.service(ReferenceService).pipe(Effect.provide(capsule.layer)),
);

if (VERSION !== "${packageJson.version}") throw new Error("package version mismatch");
if (D1.profile.dialect._tag !== "D1") throw new Error("D1 profile mismatch");
if (registryPlan.manifest.fingerprint !== manifest.fingerprint) throw new Error("manifest mismatch");
if (artifact.files.length !== 1) throw new Error("artifact projection mismatch");
if (service.value !== "packed-service") throw new Error("opaque service mismatch");
console.log(JSON.stringify({ version: VERSION, fingerprint: manifest.fingerprint }));
`;

const workerModule = `
import { D1 } from "./capsuledb-d1-bundle.mjs";

export default {
  fetch() {
    return Response.json({ dialect: D1.profile.dialect._tag });
  },
};
`;

const installConsumer = async (directory: string, tarball: string): Promise<void> => {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "capsuledb-packed-consumer",
      private: true,
      type: "module",
      dependencies: { effect: effectVersion },
    }),
  );
  await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: directory,
    encoding: "utf8",
  });
};

const runCli = async (
  runtime: string,
  directory: string,
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      runtime,
      [join(directory, "node_modules/.bin/capsuledb"), ...args],
      { cwd: directory, encoding: "utf8" },
    ));
  } catch (cause) {
    const failure = cause as {
      code?: string | number;
      message?: string;
      signal?: string;
      stderr?: string;
      stdout?: string;
    };
    throw new Error(
      `packed ${runtime} CLI failed (${String(failure.code ?? failure.signal ?? "unknown")}): ${JSON.stringify({ stdout: failure.stdout, stderr: failure.stderr, message: failure.message })}`,
      { cause },
    );
  }
  return JSON.parse(stdout) as Record<string, unknown>;
};

const runConsumer = async (runtime: "node" | "bun", directory: string): Promise<void> => {
  const manifestPath = join(directory, "manifest.json");
  const artifactPath = join(directory, "d1-artifacts");
  const writeResult = await runCli(runtime, directory, [
    "manifest",
    "write",
    "--module",
    "./capsule.mjs",
    "--export",
    "capsule",
    "--output",
    "./manifest.json",
    "--json",
  ]);
  if (writeResult.ok !== true) throw new Error(`${runtime} packed CLI write failed`);
  const checkResult = await runCli(runtime, directory, [
    "manifest",
    "check",
    "--module",
    "./capsule.mjs",
    "--export",
    "capsule",
    "--manifest",
    "./manifest.json",
    "--json",
  ]);
  if (checkResult.ok !== true) throw new Error(`${runtime} packed CLI check failed`);
  const artifactResult = await runCli(runtime, directory, [
    "d1",
    "artifact",
    "--module",
    "./capsule.mjs",
    "--export",
    "capsule",
    "--output",
    "./d1-artifacts",
    "--json",
  ]);
  if (artifactResult.ok !== true) throw new Error(`${runtime} packed CLI artifact failed`);
  const artifactCheckResult = await runCli(runtime, directory, [
    "d1",
    "check",
    "--module",
    "./capsule.mjs",
    "--export",
    "capsule",
    "--artifact",
    "./d1-artifacts",
    "--json",
  ]);
  if (artifactCheckResult.ok !== true)
    throw new Error(`${runtime} packed CLI artifact check failed`);
  await writeFile(join(directory, "capsule.mjs"), fixtureModule);
  await writeFile(join(directory, "consumer.mjs"), consumerModule);
  await execFileAsync(runtime, [join(directory, "consumer.mjs")], {
    cwd: directory,
    encoding: "utf8",
  });
  if ((await readFile(manifestPath, "utf8")).length === 0) {
    throw new Error(`${runtime} packed manifest is empty`);
  }
  if ((await readdir(artifactPath)).length !== 2) {
    throw new Error(`${runtime} packed artifact directory is incomplete`);
  }
};

describe("packed release candidate consumers", () => {
  it("runs the manifest, CLI, service, and export tracer in fresh Node, Bun, and Worker consumers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-release-candidate-"));
    try {
      const { stdout } = await execFileAsync(
        "npm",
        ["pack", "--json", "--pack-destination", directory],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const packed = JSON.parse(stdout) as ReadonlyArray<{
        filename?: string;
        files?: ReadonlyArray<{ path?: string }>;
      }>;
      const packageFile = packed[0];
      if (packageFile === undefined || packageFile.filename === undefined) {
        throw new Error("npm pack returned no filename");
      }
      const filename = packageFile.filename;
      const packedPaths = new Set(
        (packageFile.files ?? []).flatMap((file) => (file.path === undefined ? [] : [file.path])),
      );
      for (const expected of [
        "package.json",
        "README.md",
        "LICENSE",
        "dist/index.mjs",
        "dist/index.d.mts",
        "dist/cli.mjs",
        "dist/D1Artifact.mjs",
      ]) {
        assert.strictEqual(packedPaths.has(expected), true, `packed file missing: ${expected}`);
      }
      assert.strictEqual(
        [...packedPaths].some((path) => path.startsWith("src/")),
        false,
      );
      assert.strictEqual(
        [...packedPaths].some((path) => path.startsWith("tests/")),
        false,
      );
      const tarball = join(directory, filename);

      const nodeDirectory = join(directory, "node");
      const bunDirectory = join(directory, "bun");
      const workerDirectory = join(directory, "worker");
      await Promise.all([
        mkdir(nodeDirectory, { recursive: true }),
        mkdir(bunDirectory, { recursive: true }),
        mkdir(workerDirectory, { recursive: true }),
      ]);
      await installConsumer(nodeDirectory, tarball);
      await installConsumer(bunDirectory, tarball);
      await installConsumer(workerDirectory, tarball);

      await writeFile(join(nodeDirectory, "capsule.mjs"), fixtureModule);
      await writeFile(join(nodeDirectory, "consumer.mjs"), consumerModule);
      await writeFile(join(bunDirectory, "capsule.mjs"), fixtureModule);
      await writeFile(join(bunDirectory, "consumer.mjs"), consumerModule);
      await runConsumer("node", nodeDirectory);
      await runConsumer("bun", bunDirectory);

      await execFileAsync(
        "bun",
        [
          "build",
          "node_modules/capsuledb/dist/D1.mjs",
          "--target=browser",
          "--outfile=capsuledb-d1-bundle.mjs",
        ],
        { cwd: workerDirectory, encoding: "utf8" },
      );
      await writeFile(join(workerDirectory, "worker.mjs"), workerModule);
      const miniflare = new Miniflare({
        modules: true,
        scriptPath: join(workerDirectory, "worker.mjs"),
        modulesRoot: workerDirectory,
        compatibilityDate: "2026-01-01",
      });
      try {
        const response = await miniflare.dispatchFetch("http://localhost/");
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(await response.json(), {
          dialect: "D1",
        });
      } finally {
        await miniflare.dispose();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 180_000);
});
