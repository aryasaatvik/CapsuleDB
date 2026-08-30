import { assert, describe, it } from "@effect/vitest";
import { Console, Effect, Exit } from "effect";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { run } from "../../src/cli.ts";

const captureConsole = () => {
  const logs: Array<string> = [];
  const errors: Array<string> = [];
  const testConsole = Object.assign(Object.create(console), {
    log: (...values: ReadonlyArray<unknown>) => logs.push(values.join(" ")),
    error: (...values: ReadonlyArray<unknown>) => errors.push(values.join(" ")),
  }) as Console.Console;
  return { logs, errors, testConsole };
};

const runCli = async (args: ReadonlyArray<string>) => {
  const output = captureConsole();
  const exit = await Effect.runPromiseExit(
    run(args).pipe(Effect.provideService(Console.Console, output.testConsole)),
  );
  return { ...output, exit };
};

const modulePath = resolve("examples/reference-token/Capsule.ts");

describe("CapsuleDB manifest CLI", () => {
  it("writes deterministic manifests and checks them without mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-cli-manifest-"));
    const firstPath = join(directory, "first.json");
    const secondPath = join(directory, "second.json");

    const first = await runCli([
      "manifest",
      "write",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      firstPath,
      "--json",
    ]);
    const second = await runCli([
      "manifest",
      "write",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      secondPath,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(first.exit), true);
    assert.strictEqual(Exit.isSuccess(second.exit), true);
    assert.strictEqual(await readFile(firstPath, "utf8"), await readFile(secondPath, "utf8"));

    const checked = await runCli([
      "manifest",
      "check",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--manifest",
      firstPath,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(checked.exit), true);
    assert.deepStrictEqual(JSON.parse(checked.logs[0] ?? "{}"), {
      ok: true,
      command: "manifest.check",
      manifest: firstPath,
      fingerprint: "fc9c51360e94ffb6e59b2ef8eb618f4d0c03253913d3896f13d7415e55148fb7",
      capsules: 1,
      migrations: 2,
    });
  });

  it("emits structured diagnostics and a nonzero exit for manifest drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-cli-drift-"));
    const manifestPath = join(directory, "manifest.json");
    const written = await runCli([
      "manifest",
      "write",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      manifestPath,
    ]);
    assert.strictEqual(Exit.isSuccess(written.exit), true);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      capsules: Array<{ migrations: Array<{ name: string }> }>;
    };
    const firstMigration = manifest.capsules[0]?.migrations[0];
    if (firstMigration === undefined) throw new Error("fixture manifest is empty");
    firstMigration.name = "edited-name";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const checked = await runCli([
      "manifest",
      "check",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--manifest",
      manifestPath,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(checked.exit), true);
    const result = JSON.parse(checked.logs[0] ?? "{}") as {
      ok?: boolean;
      error?: { _tag?: string };
    };
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?._tag, "MigrationChecksumDrift");
    assert.deepStrictEqual(checked.errors, []);
  });

  it("writes and verifies optional D1 artifacts from the same explicit export", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-"));
    const artifactDirectory = join(directory, "d1");
    const written = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      artifactDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(written.exit), true);
    const artifact = JSON.parse(
      await readFile(join(artifactDirectory, "artifact.json"), "utf8"),
    ) as {
      files: Array<{ path: string }>;
    };
    assert.strictEqual(artifact.files.length, 2);
    const sqlContents = await Promise.all(
      artifact.files.map((file) => readFile(join(artifactDirectory, file.path), "utf8")),
    );
    assert.strictEqual(
      sqlContents.every((contents) => contents.length > 0),
      true,
    );

    const checked = await runCli([
      "d1",
      "check",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--artifact",
      artifactDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(checked.exit), true);
    assert.deepStrictEqual(JSON.parse(checked.logs[0] ?? "{}"), {
      ok: true,
      command: "d1.check",
      artifact: artifactDirectory,
      manifestFingerprint: "fc9c51360e94ffb6e59b2ef8eb618f4d0c03253913d3896f13d7415e55148fb7",
      files: artifact.files.map((file) => file.path),
    });
  });
});
