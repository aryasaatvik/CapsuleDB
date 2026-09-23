import { assert, describe, it } from "@effect/vitest";

import packageJson from "../package.json" with { type: "json" };
import { VERSION } from "../src/index.ts";

describe("package metadata", () => {
  it("exports the package version", () => {
    assert.strictEqual(VERSION, packageJson.version);
  });
});
