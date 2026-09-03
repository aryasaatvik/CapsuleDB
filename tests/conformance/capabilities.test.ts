import { assert, describe, it } from "@effect/vitest";

import { D1Profile, providerCapabilityMatrix, providerProfiles } from "../../src/Provider.ts";

describe("provider capability matrix", () => {
  it("is derived from the canonical provider profiles", () => {
    assert.deepStrictEqual(
      providerCapabilityMatrix,
      providerProfiles.map((profile) => ({
        provider: profile.provider,
        dialect: profile.dialect,
        ...profile.capabilities,
      })),
    );
    assert.deepStrictEqual(
      providerProfiles.map((profile) => profile.dialect),
      ["sqlite", "sqlite", "postgres", "sqlite"],
    );
  });

  it("keeps D1 atomic-only and bounded", () => {
    assert.deepStrictEqual(D1Profile.capabilities, {
      _tag: "AtomicBatch",
      supportsTransactions: false,
      supportsSavepoints: false,
      supportsStreaming: false,
      supportsEffectMigrations: false,
      maxStatements: 16,
      maxSqlStatementBytes: 100_000,
      maxBoundParameters: 100,
    });
  });
});
