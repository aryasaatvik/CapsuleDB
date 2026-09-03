import { assert, describe, it } from "@effect/vitest";
import { Console, Effect, Exit } from "effect";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
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
      fingerprint: "fce32d5c34be03540e8cb95891030d32d893e0e5d50eda10566eeca69a9c7327",
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

    const artifactIndex = JSON.parse(
      await readFile(join(artifactDirectory, "artifact.json"), "utf8"),
    ) as { files: Array<Record<string, unknown>> };
    const firstFile = artifactIndex.files[0];
    const firstPath = typeof firstFile?.path === "string" ? firstFile.path : undefined;
    if (firstFile === undefined || firstPath === undefined) {
      throw new Error("artifact index is missing its first file");
    }
    const firstSql = await readFile(join(artifactDirectory, firstPath), "utf8");
    firstFile.path = "obsolete.sql";
    await writeFile(join(artifactDirectory, "obsolete.sql"), firstSql);
    await writeFile(join(artifactDirectory, "unrelated.sql"), "SELECT unrelated");
    await writeFile(
      join(artifactDirectory, "artifact.json"),
      `${JSON.stringify(artifactIndex, null, 2)}\n`,
    );
    const regenerated = await runCli([
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
    assert.strictEqual(Exit.isSuccess(regenerated.exit), true);
    const regeneratedEntries = await readdir(artifactDirectory);
    assert.strictEqual(regeneratedEntries.includes("obsolete.sql"), false);
    assert.strictEqual(regeneratedEntries.includes("unrelated.sql"), true);

    const checkWithUnknown = await runCli([
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
    assert.strictEqual(Exit.isFailure(checkWithUnknown.exit), true);
    const unknownError = JSON.parse(checkWithUnknown.logs[0] ?? "{}") as {
      error?: { message?: string };
    };
    assert.strictEqual(unknownError.error?.message?.includes("unrelated.sql"), true);
    await unlink(join(artifactDirectory, "unrelated.sql"));

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
      manifestFingerprint: "fce32d5c34be03540e8cb95891030d32d893e0e5d50eda10566eeca69a9c7327",
      files: artifact.files.map((file) => file.path),
    });
  });

  it("fails closed without mutating directories that lack a usable artifact index", async () => {
    const malformedDirectory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-malformed-"));
    const malformedIndex = join(malformedDirectory, "artifact.json");
    const malformedSql = join(malformedDirectory, "obsolete.sql");
    await writeFile(malformedIndex, "{not valid json}\n");
    await writeFile(malformedSql, "SELECT malformed");
    const malformedBefore = await Promise.all([
      readFile(malformedIndex, "utf8"),
      readFile(malformedSql, "utf8"),
      readdir(malformedDirectory),
    ]);

    const malformed = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      malformedDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(malformed.exit), true);
    assert.deepStrictEqual(
      [
        await readFile(malformedIndex, "utf8"),
        await readFile(malformedSql, "utf8"),
        await readdir(malformedDirectory),
      ],
      malformedBefore,
    );

    const missingDirectory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-missing-"));
    const missingSql = join(missingDirectory, "obsolete.sql");
    await writeFile(missingSql, "SELECT missing");
    const missingBefore = await readdir(missingDirectory);
    const missing = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      missingDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(missing.exit), true);
    assert.deepStrictEqual(await readdir(missingDirectory), missingBefore);
    assert.strictEqual(await readFile(missingSql, "utf8"), "SELECT missing");
  });

  it("fails closed when a stale indexed SQL file was edited", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-edited-"));
    const written = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      directory,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(written.exit), true);

    const indexPath = join(directory, "artifact.json");
    const artifactIndex = JSON.parse(await readFile(indexPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    const firstFile = artifactIndex.files[0];
    if (firstFile === undefined) throw new Error("artifact index is missing its first file");
    const originalPath = firstFile.path;
    firstFile.path = "removed.sql";
    await writeFile(join(directory, firstFile.path), "SELECT edited");
    await writeFile(indexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`);
    const before = await Promise.all([
      readFile(indexPath, "utf8"),
      readFile(join(directory, originalPath), "utf8"),
      readFile(join(directory, "removed.sql"), "utf8"),
      readdir(directory),
    ]);

    const regenerated = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      directory,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(regenerated.exit), true);
    assert.deepStrictEqual(
      [
        await readFile(indexPath, "utf8"),
        await readFile(join(directory, originalPath), "utf8"),
        await readFile(join(directory, "removed.sql"), "utf8"),
        await readdir(directory),
      ],
      before,
    );
  });

  it("fails closed when a stale indexed SQL path is not a regular file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-non-file-"));
    const written = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      directory,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(written.exit), true);

    const indexPath = join(directory, "artifact.json");
    const artifactIndex = JSON.parse(await readFile(indexPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    const firstFile = artifactIndex.files[0];
    if (firstFile === undefined) throw new Error("artifact index is missing its first file");
    const originalPath = firstFile.path;
    firstFile.path = "directory.sql";
    await mkdir(join(directory, firstFile.path));
    await writeFile(indexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`);
    const before = await Promise.all([
      readFile(indexPath, "utf8"),
      readFile(join(directory, originalPath), "utf8"),
      readdir(directory),
    ]);
    const directoryStat = await lstat(join(directory, firstFile.path));
    assert.strictEqual(directoryStat.isDirectory(), true);

    const regenerated = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      directory,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(regenerated.exit), true);
    assert.deepStrictEqual(
      [
        await readFile(indexPath, "utf8"),
        await readFile(join(directory, originalPath), "utf8"),
        await readdir(directory),
      ],
      before,
    );

    const symlinkDirectory = await mkdtemp(join(tmpdir(), "capsuledb-cli-d1-symlink-"));
    const symlinkIndexPath = join(symlinkDirectory, "artifact.json");
    const symlinkWritten = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      symlinkDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isSuccess(symlinkWritten.exit), true);
    const symlinkIndex = JSON.parse(await readFile(symlinkIndexPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    const symlinkFile = symlinkIndex.files[0];
    if (symlinkFile === undefined) throw new Error("artifact index is missing its first file");
    const symlinkOriginalPath = symlinkFile.path;
    symlinkFile.path = "symlink.sql";
    await symlink(
      join(symlinkDirectory, symlinkOriginalPath),
      join(symlinkDirectory, symlinkFile.path),
    );
    await writeFile(symlinkIndexPath, `${JSON.stringify(symlinkIndex, null, 2)}\n`);
    const symlinkBefore = await Promise.all([
      readFile(symlinkIndexPath, "utf8"),
      readFile(join(symlinkDirectory, symlinkOriginalPath), "utf8"),
      readdir(symlinkDirectory),
    ]);

    const symlinkRegenerated = await runCli([
      "d1",
      "artifact",
      "--module",
      modulePath,
      "--export",
      "capsule",
      "--output",
      symlinkDirectory,
      "--json",
    ]);
    assert.strictEqual(Exit.isFailure(symlinkRegenerated.exit), true);
    assert.deepStrictEqual(
      [
        await readFile(symlinkIndexPath, "utf8"),
        await readFile(join(symlinkDirectory, symlinkOriginalPath), "utf8"),
        await readdir(symlinkDirectory),
      ],
      symlinkBefore,
    );
  });
});
