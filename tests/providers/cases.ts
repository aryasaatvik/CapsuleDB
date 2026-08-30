import { SqliteClient } from "@effect/sql-sqlite-bun";
import { LibsqlClient } from "@effect/sql-libsql";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BunSqliteProfile,
  D1Profile,
  LibsqlProfile,
  PostgresProfile,
  type ProviderProfile,
} from "../../src/Provider.ts";
import { withD1 } from "./d1.ts";
import { withPostgresSql } from "./postgres.ts";

/** Generic host-client runner used by the shared provider conformance suite. */
export type ProviderClientRunner = <A, E>(
  effect: (client: SqlClient.SqlClient) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | Error>;

export interface ProviderCase {
  readonly name: string;
  readonly profile: ProviderProfile;
  readonly withClient: ProviderClientRunner;
}

const withBunSqlite: ProviderClientRunner = <A, E>(
  effect: (client: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Effect.service(SqlClient.SqlClient);
      return yield* effect(client);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );

const withLibsql: ProviderClientRunner = <A, E>(
  effect: (client: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "capsuledb-suite-")));
      const client = createClient({ url: `file:${join(directory, "capsuledb.sqlite")}` });
      return { client, directory };
    }),
    ({ client }: { readonly client: Client }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* Effect.service(SqlClient.SqlClient);
          return yield* effect(sql);
        }).pipe(Effect.provide(LibsqlClient.layer({ liveClient: client }))),
      ),
    ({ client, directory }: { readonly client: Client; readonly directory: string }) =>
      Effect.gen(function* () {
        client.close();
        yield* Effect.promise(() => rm(directory, { force: true, recursive: true }));
      }),
  );

const withPostgres: ProviderClientRunner = <A, E>(
  effect: (client: SqlClient.SqlClient) => Effect.Effect<A, E>,
) => withPostgresSql(effect);

const withD1Client: ProviderClientRunner = <A, E>(
  effect: (client: SqlClient.SqlClient) => Effect.Effect<A, E>,
) => withD1((client) => effect(client));

/** One canonical provider list; provider tests consume this instead of copies. */
export const providerCases: ReadonlyArray<ProviderCase> = [
  { name: "Bun SQLite", profile: BunSqliteProfile, withClient: withBunSqlite },
  { name: "libSQL", profile: LibsqlProfile, withClient: withLibsql },
  { name: "PostgreSQL", profile: PostgresProfile, withClient: withPostgres },
  { name: "Cloudflare D1", profile: D1Profile, withClient: withD1Client },
];
