import { Effect, Schema } from "effect";

import type { Dialect } from "./Dialect.ts";
import { EmitDrift, InvalidDefinition } from "./Error.ts";
import {
  bodyFor,
  type Manifest,
  type ManifestBody,
  type ManifestCapsule,
  type ManifestMigration,
} from "./Manifest.ts";
import { providerDialect, providerName, type Provider } from "./Provider.ts";
import { ledgerTables } from "./internal/transactional-migrator.ts";

/**
 * The index every emitted folder carries.
 *
 * An emit folder is shared with the host's own migration pipeline, so CapsuleDB
 * cannot guess which files are its own. The index is the record of ownership:
 * regeneration deletes only what a previous index claimed, and `check` ignores
 * everything neither the index nor the current projection names.
 */
export const INDEX_PATH = "capsuledb.emit.json";

/** The first bytes of every emitted `.sql` file. */
export const GENERATED_MARKER = "-- capsuledb:";

export const EmitIndex = Schema.Struct({
  version: Schema.Literal(1),
  dialect: Schema.Union([Schema.Literal("postgres"), Schema.Literal("sqlite")]),
  provider: Schema.String,
  prefix: Schema.String,
  files: Schema.Array(Schema.String),
});

export type EmitIndex = typeof EmitIndex.Type;

/** One file `capsuledb emit` writes and `capsuledb check` compares. */
export const EmitFile = Schema.Struct({
  path: Schema.String,
  contents: Schema.String,
});

export type EmitFile = typeof EmitFile.Type;

export interface EmitOptions {
  readonly dialect: Dialect;
  /**
   * The provider identity stamped into the emitted ledger rows. Every SQLite
   * provider shares one dialect but keeps its own identity, so a libSQL or D1
   * host has to say so here. Defaults to the dialect's canonical provider.
   */
  readonly provider?: Provider;
  /** Ledger table prefix; must match the prefix the host's registry uses. */
  readonly prefix?: string;
}

export type EmitError = InvalidDefinition | EmitDrift;

const canonicalProvider = (dialect: Dialect): Provider =>
  dialect === "postgres" ? "Postgres" : "BunSqlite";

const slug = (value: string): string =>
  value
    .replaceAll(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * A SQL expression producing the exact `applied_at` format the ledger accepts.
 *
 * Emitted files are applied at an unknown time, so the timestamp has to come
 * from the database rather than from the machine that ran `emit`.
 */
const appliedAt = (dialect: Dialect): string =>
  dialect === "postgres"
    ? `to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    : `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

const statementsOf = (body: ManifestBody): Effect.Effect<ReadonlyArray<string>, EmitError> => {
  const dynamic = body.operations.find((operation) => operation._tag !== "Sql");
  if (dynamic !== undefined) {
    return Effect.fail(
      new InvalidDefinition({
        subject: `emit ${body.dialect} body`,
        reason: "an Effect migration step has no SQL form; keep it on the runtime preparation path",
      }),
    );
  }
  return Effect.succeed(
    body.operations.flatMap((operation) =>
      operation._tag === "Sql" ? [...operation.statements] : [],
    ),
  );
};

const header = (lines: ReadonlyArray<string>): string =>
  lines.map((line) => `-- ${line}`).join("\n");

/** Whether a file still looks like the emitted file an index claims it is. */
export const isGenerated = (contents: string): boolean => contents.startsWith(GENERATED_MARKER);

const block = (statements: ReadonlyArray<string>): string =>
  statements.map((statement) => `${statement};`).join("\n\n");

const ledgerDdl = (ledger: string, metadata: string, dialect: Dialect): ReadonlyArray<string> => [
  `CREATE TABLE IF NOT EXISTS "${ledger}" (
  capsule_id TEXT NOT NULL,
  migration_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '${dialect === "postgres" ? "postgres" : "sqlite"}',
  dialect TEXT,
  PRIMARY KEY (capsule_id, migration_id)
)`,
  `CREATE TABLE IF NOT EXISTS "${metadata}" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL
)`,
];

const ledgerInsert = (
  ledger: string,
  capsule: ManifestCapsule,
  migration: ManifestMigration,
  body: ManifestBody,
  provider: string,
): string =>
  `INSERT INTO "${ledger}" (capsule_id, migration_id, name, checksum, applied_at, provider, dialect)
VALUES (${quote(capsule.id)}, ${migration.id}, ${quote(migration.name)}, ${quote(body.checksum)}, ${appliedAt(body.dialect)}, ${quote(provider)}, ${quote(body.dialect)})`;

const metadataUpsert = (metadata: string, fingerprint: string, provider: string): string =>
  `INSERT INTO "${metadata}" (id, fingerprint, provider)
VALUES (1, ${quote(fingerprint)}, ${quote(provider)})
ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, provider = excluded.provider`;

/**
 * Project a manifest into ordered SQL files a host applies with its own
 * migration pipeline.
 *
 * Files are numbered by CapsuleDB's own migration order rather than by wall
 * clock, so the projection is deterministic and `check` can compare it byte for
 * byte. They sort the same way a timestamped folder does.
 */
export const emit = (
  manifest: Manifest,
  options: EmitOptions,
): Effect.Effect<ReadonlyArray<EmitFile>, EmitError> =>
  Effect.gen(function* () {
    const provider = options.provider ?? canonicalProvider(options.dialect);
    if (providerDialect(provider) !== options.dialect) {
      return yield* Effect.fail(
        new InvalidDefinition({
          subject: "emit provider",
          reason: `${provider} does not speak the ${options.dialect} dialect`,
        }),
      );
    }
    const tables = yield* Effect.try({
      try: () => ledgerTables(options.prefix),
      catch: (cause) =>
        cause instanceof InvalidDefinition
          ? cause
          : new InvalidDefinition({ subject: "emit prefix", reason: String(cause) }),
    });
    const stamp = providerName(provider);

    const files: Array<EmitFile> = [
      {
        path: "0000_capsuledb_ledger.sql",
        contents: `${header([
          "capsuledb: registry ledger and readiness metadata",
          `dialect: ${options.dialect}`,
        ])}\n${block(ledgerDdl(tables.ledger, tables.metadata, options.dialect))}\n`,
      },
    ];

    let index = 0;
    for (const capsule of manifest.capsules) {
      for (const migration of capsule.migrations) {
        const body = bodyFor(migration, options.dialect);
        if (body === undefined) {
          return yield* Effect.fail(
            new InvalidDefinition({
              subject: `emit ${capsule.id}/${migration.id}`,
              reason: `the migration has no ${options.dialect} body`,
            }),
          );
        }
        index += 1;
        files.push({
          path: `${String(index).padStart(4, "0")}_${slug(capsule.namespace)}_${slug(migration.name)}.sql`,
          contents: `${header([
            `capsuledb: ${capsule.id} migration ${migration.id} (${migration.name})`,
            `dialect: ${options.dialect}`,
            `checksum: ${body.checksum}`,
          ])}\n${block([
            ...(yield* statementsOf(body)),
            ledgerInsert(tables.ledger, capsule, migration, body, stamp),
          ])}\n`,
        });
      }
    }

    files.push({
      path: `${String(index + 1).padStart(4, "0")}_capsuledb_readiness.sql`,
      contents: `${header([
        "capsuledb: readiness metadata for the applied history",
        `fingerprint: ${manifest.fingerprint}`,
      ])}\n${block([metadataUpsert(tables.metadata, manifest.fingerprint, stamp)])}\n`,
    });

    const emitIndex: EmitIndex = {
      version: 1,
      dialect: options.dialect,
      provider: stamp,
      prefix: options.prefix ?? "capsuledb",
      files: files.map((file) => file.path),
    };
    files.push({
      path: INDEX_PATH,
      contents: `${JSON.stringify(emitIndex, null, 2)}\n`,
    });

    return Object.freeze(files);
  });

/** Read the ownership index out of a folder's files, if it has one. */
export const indexOf = (files: ReadonlyArray<EmitFile>): EmitIndex | undefined => {
  const file = files.find((candidate) => candidate.path === INDEX_PATH);
  if (file === undefined) return undefined;
  try {
    return Schema.decodeUnknownSync(EmitIndex)(JSON.parse(file.contents));
  } catch {
    return undefined;
  }
};

/**
 * Compare an emitted folder against the projection the current library
 * produces.
 *
 * Only CapsuleDB's own files are considered: every projected file must be
 * present and identical, and every file a previous index claimed must still be
 * one the projection emits. Anything the host put in the folder is not
 * CapsuleDB's to police.
 */
export const check = (
  expected: ReadonlyArray<EmitFile>,
  actual: ReadonlyArray<EmitFile>,
): Effect.Effect<void, EmitDrift> =>
  Effect.gen(function* () {
    for (const file of expected) {
      const found = actual.find((candidate) => candidate.path === file.path);
      if (found === undefined) {
        return yield* Effect.fail(
          new EmitDrift({ path: file.path, reason: "the emitted folder is missing this file" }),
        );
      }
      if (found.contents !== file.contents) {
        return yield* Effect.fail(
          new EmitDrift({
            path: file.path,
            reason: "the emitted file differs from the current projection",
          }),
        );
      }
    }
    const projected = new Set(expected.map((file) => file.path));
    for (const owned of indexOf(actual)?.files ?? []) {
      if (projected.has(owned)) continue;
      return yield* Effect.fail(
        new EmitDrift({
          path: owned,
          reason: "the folder still holds a file the current projection no longer emits",
        }),
      );
    }
  });
