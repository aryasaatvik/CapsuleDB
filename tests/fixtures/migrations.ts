import { Layer } from "effect";

import * as Capsule from "../../src/Capsule.ts";
import * as Migration from "../../src/Migration.ts";

/** One additive migration whose raw body is identical on every dialect. */
export const makeFixtureMigration = (
  id: number,
  name: string,
  source: string,
): Migration.Migration =>
  Migration.make({
    id,
    name,
    risk: "additive",
    steps: [Migration.sql({ postgres: [source], sqlite: [source] })],
  });

/** A capsule with no service, used wherever only migration behavior matters. */
export const makeFixtureCapsule = (
  migrations: ReadonlyArray<Migration.Migration>,
  id = "reference.tokens",
): Capsule.Capsule<never, never, never> => Capsule.make({ id, migrations, layer: Layer.empty });
