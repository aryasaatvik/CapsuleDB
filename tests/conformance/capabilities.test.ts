import { assert, describe, it } from "@effect/vitest";

import {
  D1Profile,
  providerCapabilityMatrix,
  providerDialectName,
  providerProfiles,
} from "../../src/Provider.ts";

describe("provider capability matrix", () => {
  it("is derived from the canonical provider profiles", () => {
    assert.deepStrictEqual(
      providerCapabilityMatrix,
      providerProfiles.map((profile) => ({
        dialect: providerDialectName(profile.dialect),
        ...profile.capabilities,
      })),
    );
    assert.deepStrictEqual(
      providerProfiles.map((profile) => profile.dialect._tag),
      ["Sqlite", "Libsql", "Postgres", "D1"],
    );
  });

  it("keeps D1 atomic-only and bounded", () => {
    assert.deepStrictEqual(D1Profile.capabilities, {
      _tag: "AtomicBatch",
      supportsTransactions: false,
      supportsSavepoints: false,
      supportsStreaming: false,
      supportsEffectMigrations: false,
      maxStatements: 2,
      maxSqlStatementBytes: 100_000,
      maxBoundParameters: 100,
    });
  });
});
