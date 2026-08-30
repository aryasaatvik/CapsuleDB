import { Effect, Layer } from "effect";

import { makeCapsule, type Capsule } from "../../src/Capsule.ts";
import { makeMigration, sqlMigrationBody, type Migration } from "../../src/Migration.ts";

export const makeFixtureMigration = (
  id: number,
  name: string,
  source: string,
): Effect.Effect<Migration, never> =>
  makeMigration({
    id,
    name,
    risk: "additive",
    providers: {
      Sqlite: sqlMigrationBody(source, [source]),
      Libsql: sqlMigrationBody(source, [source]),
      Postgres: sqlMigrationBody(source, [source]),
      D1: sqlMigrationBody(source, [source]),
    },
  }).pipe(Effect.orDie);

export const makeFixtureCapsule = (
  migrations: ReadonlyArray<Migration>,
  id = "reference.tokens",
): Effect.Effect<Capsule<never, unknown, unknown>, never> =>
  makeCapsule({ id, migrations, layer: Layer.empty }).pipe(Effect.orDie);
