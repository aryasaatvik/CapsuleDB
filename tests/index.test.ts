import { assert, describe, it } from "@effect/vitest";

import { VERSION } from "../src/index.ts";

describe("package metadata", () => {
  it("exports the package version", () => {
    assert.strictEqual(VERSION, "0.1.0");
  });
});
