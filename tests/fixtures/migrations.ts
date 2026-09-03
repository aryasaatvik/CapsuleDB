import { Layer } from "effect";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";

const DIALECT_SOURCE = ["Sqlite", "Postgres"] as const;

/** One additive migration whose body is identical on every dialect. */
export const makeFixtureMigration = (
  id: number,
  name: string,
  source: string,
): Migration.Migration =>
  Migration.make({
    id,
    name,
    risk: "additive",
    providers: Object.fromEntries(
      DIALECT_SOURCE.map((dialect) => [dialect, Migration.sqlBody([source])]),
    ),
  });

/** A capsule with no service, used wherever only migration behavior matters. */
export const makeFixtureCapsule = (
  migrations: ReadonlyArray<Migration.Migration>,
  id = "reference.tokens",
): Capsule.Capsule<never, never, never> => Capsule.make({ id, migrations, layer: Layer.empty });
