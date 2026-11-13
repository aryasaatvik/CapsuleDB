import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { capsule, main } from "../../examples/quick-start.ts";

// The site's quick start renders examples/quick-start.ts; this runs it against the built package.
describe("examples/quick-start.ts", () => {
  it.effect("prepares the capsule and returns the second visit", () =>
    Effect.gen(function* () {
      assert.strictEqual(capsule.namespace, "capsule_example_2e_visits");
      assert.strictEqual(yield* main, 2);
    }),
  );
});
