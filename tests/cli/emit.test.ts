import { SqliteClient } from "@effect/sql-sqlite-bun";
import { assert, describe, it } from "@effect/vitest";
import { Console, Effect, Exit, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as Capsule from "../../src/Capsule.ts";
import { run } from "../../src/cli.ts";
import type { Dialect } from "../../src/Dialect.ts";
import * as Migration from "../../src/Migration.ts";
import { BunSqliteProfile, PostgresProfile } from "../../src/Provider.ts";
import * as Registry from "../../src/Registry.ts";
import * as Schema from "../../src/Schema.ts";
import { sha256 } from "../../src/internal/checksum.ts";
import { withPostgresSql } from "../providers/postgres.ts";

const modulePath = resolve("examples/reference-token/Capsule.ts");

const sha256Of = (contents: string): Promise<string> => Effect.runPromise(sha256(contents));

const runCli = async (args: ReadonlyArray<string>) => {
  const logs: Array<string> = [];
  const errors: Array<string> = [];
  const testConsole = Object.assign(Object.create(console), {
    log: (...values: ReadonlyArray<unknown>) => logs.push(values.join(" ")),
    error: (...values: ReadonlyArray<unknown>) => errors.push(values.join(" ")),
  }) as Console.Console;
  const exit = await Effect.runPromiseExit(
    run(args).pipe(Effect.provideService(Console.Console, testConsole)),
  );
  return { logs, errors, exit };
};

const emitTo = async (out: string, dialect: Dialect) =>
  runCli([
    "emit",
    "--module",
    modulePath,
    "--export",
    "capsule",
    "--dialect",
    dialect,
    "--out",
    out,
    "--json",
  ]);

const checkOf = async (out: string, dialect: Dialect) =>
  runCli([
    "check",
    "--module",
    modulePath,
    "--export",
    "capsule",
    "--dialect",
    dialect,
    "--out",
    out,
    "--json",
  ]);

/** Apply an emitted folder the way a host's own migration pipeline would. */
const applyEmitted = (out: string) =>
  Effect.gen(function* () {
    const sql = yield* Effect.service(SqlClient.SqlClient);
    const entries = (yield* Effect.promise(() => readdir(out)))
      .filter((entry) => entry.endsWith(".sql"))
      .sort();
    for (const entry of entries) {
      const contents = yield* Effect.promise(() => readFile(join(out, entry), "utf8"));
      for (const statement of contents
        .split(/;\s*\n/)
        .map((part) =>
          part
            .split("\n")
            .filter((line) => !line.startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter((part) => part.length > 0)) {
        yield* sql.unsafe(statement);
      }
    }
  });

describe("capsuledb emit", () => {
  it("writes deterministic files for both dialects", async () => {
    const first = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    const second = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));

    assert.strictEqual(Exit.isSuccess((await emitTo(first, "postgres")).exit), true);
    assert.strictEqual(Exit.isSuccess((await emitTo(second, "postgres")).exit), true);
    const entries = await readdir(first);
    const pairs = await Promise.all(
      entries.map(async (entry) => [
        await readFile(join(first, entry), "utf8"),
        await readFile(join(second, entry), "utf8"),
      ]),
    );
    for (const [left, right] of pairs) assert.strictEqual(left, right);
    assert.deepStrictEqual([...entries].sort(), [
      "0000_capsuledb_ledger.sql",
      "0001_capsule_reference_2e_tokens_create_tokens.sql",
      "0002_capsule_reference_2e_tokens_add_token_audit.sql",
      "0003_capsuledb_readiness.sql",
      "capsuledb.emit.json",
    ]);

    const sqlite = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(sqlite, "sqlite");
    const postgresDdl = await readFile(
      join(first, "0001_capsule_reference_2e_tokens_create_tokens.sql"),
      "utf8",
    );
    const sqliteDdl = await readFile(
      join(sqlite, "0001_capsule_reference_2e_tokens_create_tokens.sql"),
      "utf8",
    );
    assert.notStrictEqual(postgresDdl, sqliteDdl);
    assert.strictEqual(sqliteDdl.includes("strftime"), true);
  });

  it("checks an emitted folder and rejects every drift class", async () => {
    const out = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(out, "postgres");
    assert.strictEqual(Exit.isSuccess((await checkOf(out, "postgres")).exit), true);

    // The library has a migration the folder does not.
    const missing = join(out, "0002_capsule_reference_2e_tokens_add_token_audit.sql");
    const contents = await readFile(missing, "utf8");
    await writeFile(missing, "");
    const edited = await checkOf(out, "postgres");
    assert.strictEqual(Exit.isFailure(edited.exit), true);
    assert.strictEqual(
      (JSON.parse(edited.logs[0] ?? "{}") as { error?: { _tag?: string } }).error?._tag,
      "EmitDrift",
    );
    await writeFile(missing, contents);

    // An emitted folder for the other dialect is not this one.
    assert.strictEqual(Exit.isFailure((await checkOf(out, "sqlite")).exit), true);

    // A file the host owns in the same folder is not CapsuleDB's to police.
    await writeFile(join(out, "9999_host_owned.sql"), "SELECT 1;\n");
    assert.strictEqual(Exit.isSuccess((await checkOf(out, "postgres")).exit), true);

    // A file a previous index claimed but the projection no longer emits is.
    const index = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as {
      files: Array<{ path: string; checksum: string }>;
    };
    index.files.push({
      path: "0009_capsule_reference_2e_tokens_gone.sql",
      checksum: "0".repeat(64),
    });
    await writeFile(join(out, "capsuledb.emit.json"), `${JSON.stringify(index, null, 2)}\n`);
    assert.strictEqual(Exit.isFailure((await checkOf(out, "postgres")).exit), true);
  });

  it("removes its own stale files on regeneration and keeps the host's", async () => {
    const out = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(out, "postgres");

    // A rename leaves an obsolete generated file behind, recorded in the index
    // written by the previous run. A host file that merely looks generated must
    // survive, because ownership comes from the index and not from contents.
    const stale = "0001_capsule_reference_2e_tokens_old_name.sql";
    const staleContents = "-- capsuledb: renamed away\nSELECT 1;\n";
    await writeFile(join(out, stale), staleContents);
    await writeFile(join(out, "9000_host_owned.sql"), "-- capsuledb: not really\nSELECT 'host';\n");
    const previous = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as {
      files: Array<{ path: string; checksum: string }>;
    };
    previous.files.push({ path: stale, checksum: await sha256Of(staleContents) });
    await writeFile(join(out, "capsuledb.emit.json"), `${JSON.stringify(previous, null, 2)}\n`);

    const regenerated = await emitTo(out, "postgres");
    assert.strictEqual(Exit.isSuccess(regenerated.exit), true);
    assert.deepStrictEqual(
      (JSON.parse(regenerated.logs[0] ?? "{}") as { removed?: ReadonlyArray<string> }).removed,
      ["0001_capsule_reference_2e_tokens_old_name.sql"],
    );

    const entries = await readdir(out);
    assert.strictEqual(entries.includes("0001_capsule_reference_2e_tokens_old_name.sql"), false);
    assert.strictEqual(entries.includes("9000_host_owned.sql"), true);
  });

  it("refuses to overwrite a hand-edited generated file", async () => {
    const out = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(out, "postgres");

    // The path is still one the projection emits, so regeneration would
    // otherwise replace it without looking.
    const edited = join(out, "0001_capsule_reference_2e_tokens_create_tokens.sql");
    const mine = "-- capsuledb: my deployment tweak\nSELECT 'mine';\n";
    await writeFile(edited, mine);

    const regenerated = await emitTo(out, "postgres");
    assert.strictEqual(Exit.isFailure(regenerated.exit), true);
    assert.strictEqual(
      (JSON.parse(regenerated.logs[0] ?? "{}") as { error?: { _tag?: string } }).error?._tag,
      "InvalidDefinition",
    );
    assert.strictEqual(await readFile(edited, "utf8"), mine);
  });

  it("regenerates unchanged and library-upgraded files in place", async () => {
    const out = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(out, "postgres");
    const before = await readFile(
      join(out, "0001_capsule_reference_2e_tokens_create_tokens.sql"),
      "utf8",
    );

    // A second run over an untouched folder is a no-op, not a refusal.
    assert.strictEqual(Exit.isSuccess((await emitTo(out, "postgres")).exit), true);
    assert.strictEqual(
      await readFile(join(out, "0001_capsule_reference_2e_tokens_create_tokens.sql"), "utf8"),
      before,
    );
    assert.strictEqual(Exit.isSuccess((await checkOf(out, "postgres")).exit), true);
  });

  it("refuses to delete a claimed path the host has taken over", async () => {
    const out = await mkdtemp(join(tmpdir(), "capsuledb-emit-"));
    await emitTo(out, "postgres");

    // The index claims this path and the file even opens with the CapsuleDB
    // comment marker, but the bytes are the host's, so they cannot hash to what
    // the recorded emit wrote.
    const taken = "0001_capsule_reference_2e_tokens_old_name.sql";
    await writeFile(join(out, taken), "-- capsuledb: looks generated\nSELECT 'now mine';\n");
    const index = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as {
      files: Array<{ path: string; checksum: string }>;
    };
    index.files.push({ path: taken, checksum: "0".repeat(64) });
    await writeFile(join(out, "capsuledb.emit.json"), `${JSON.stringify(index, null, 2)}\n`);

    const regenerated = await emitTo(out, "postgres");
    assert.strictEqual(Exit.isFailure(regenerated.exit), true);
    assert.strictEqual(
      (JSON.parse(regenerated.logs[0] ?? "{}") as { error?: { _tag?: string } }).error?._tag,
      "InvalidDefinition",
    );
    assert.strictEqual(
      await readFile(join(out, taken), "utf8"),
      "-- capsuledb: looks generated\nSELECT 'now mine';\n",
    );
  });

  it.effect("boots in assert mode after the emitted SQL is applied on SQLite", () =>
    Effect.gen(function* () {
      const out = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "capsuledb-emit-")));
      yield* Effect.promise(() => emitTo(out, "sqlite"));

      const { capsule } = yield* Effect.promise(
        () => import("../../examples/reference-token/Capsule.ts"),
      );
      const options = {
        provider: BunSqliteProfile,
        capsules: [capsule],
        mode: "assert" as const,
      };

      yield* Effect.gen(function* () {
        // Before the files are applied, assert mode refuses to boot.
        const failure = yield* Effect.scoped(
          Layer.build(Registry.layer(options)).pipe(Effect.flip),
        );
        assert.strictEqual(failure._tag, "NotReady");

        yield* applyEmitted(out);
        assert.strictEqual((yield* Registry.status(options))._tag, "Ready");
        yield* Effect.scoped(Layer.build(Registry.layer(options)));
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);
    }),
  );

  it.effect(
    "boots in assert mode after the emitted SQL is applied on PostgreSQL",
    () =>
      Effect.gen(function* () {
        const out = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "capsuledb-emit-")));
        yield* Effect.promise(() => emitTo(out, "postgres"));
        const { capsule } = yield* Effect.promise(
          () => import("../../examples/reference-token/Capsule.ts"),
        );

        yield* withPostgresSql((client) =>
          Effect.gen(function* () {
            yield* applyEmitted(out);
            const options = {
              provider: PostgresProfile,
              capsules: [capsule],
              mode: "assert" as const,
            };
            assert.strictEqual((yield* Registry.status(options))._tag, "Ready");
            yield* Effect.scoped(Layer.build(Registry.layer(options)));
          }).pipe(Effect.provideService(SqlClient.SqlClient, client)),
        );
      }),
    60_000,
  );

  it.effect("assert mode refuses to migrate a database that is behind", () =>
    Effect.gen(function* () {
      const table = Schema.table("assert_probe", {
        columns: { id: Schema.text() },
        primaryKey: ["id"],
      });
      const capsule = Capsule.make({
        id: "assert.probe",
        migrations: [
          Migration.make({
            id: 1,
            name: "create-probe",
            risk: "additive",
            steps: [Migration.createTable(table)],
          }),
        ],
        layer: Layer.empty,
      });
      const options = { provider: BunSqliteProfile, capsules: [capsule], mode: "assert" as const };

      yield* Effect.gen(function* () {
        const failure = yield* Registry.assert(options).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "NotReady");

        const sql = yield* Effect.service(SqlClient.SqlClient);
        assert.deepStrictEqual(
          yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'assert_probe'`,
          [],
        );
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })), Effect.scoped);
    }),
  );
});
