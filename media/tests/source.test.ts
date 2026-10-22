import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "../scripts/projects";
import {
  capsuleDefinition,
  deferredReadiness,
  hostComposition,
  ledgerTables,
  profiles,
  referenceTables,
  tokenOperations,
  tokenUsage,
} from "../src/scenes/source";

const read = (file: string) => readFileSync(join(repository, file), "utf8");

describe("on-screen code matches the repository", () => {
  test.each([capsuleDefinition, hostComposition, deferredReadiness])(
    "$file excerpt is verbatim",
    (excerpt) => {
      expect(read(excerpt.file)).toContain(excerpt.code);
    },
  );

  test("reference tables and columns match Capsule.ts", () => {
    const source = read("examples/reference-token/Capsule.ts");
    for (const table of referenceTables) {
      expect(source).toContain(`Schema.table("${table.name}"`);
      for (const column of table.columns) {
        const name = column.replace(/\?$/, "");
        const nullable = column.endsWith("?");
        expect(source).toContain(
          nullable ? `${name}: Schema.text({ nullable: true })` : `${name}: Schema.text()`,
        );
      }
    }
  });

  test("token operations match OneTimeTokensService", () => {
    const source = read("examples/reference-token/OneTimeTokens.ts");
    for (const operation of tokenOperations) {
      expect(source).toMatch(
        new RegExp(
          `readonly ${operation.name}: \\(\\s*${operation.parameter === "expiresAt" ? "expiresAt" : "token"}: unknown,\\s*\\) => Effect\\.Effect<\\s*${operation.returns}`,
        ),
      );
    }
    for (const line of tokenUsage.lines) {
      if (line.result === undefined) continue;
      expect(source).toMatch(new RegExp(`\\b${line.result.text}\\b`));
    }
    expect(source).toContain("export class OneTimeTokens extends Context.Service");
  });

  test("ledger tables use the default prefix", () => {
    expect(read("src/internal/transactional-migrator.ts")).toContain(
      "{ ledger: `${prefix}_registry_ledger`, metadata: `${prefix}_registry_metadata` }",
    );
    expect(read("src/Registry.ts")).toContain("defaults to\n   * `capsuledb`");
    expect(ledgerTables).toEqual(["capsuledb_registry_ledger", "capsuledb_registry_metadata"]);
  });

  test("provider profiles are exported", () => {
    for (const profile of profiles) {
      const module = profile.replace(/\.profile$/, "");
      expect(read(`src/${module}.ts`)).toMatch(/^export const profile\b/m);
    }
  });

  test("the reference namespace is the ID's derivation", () => {
    const encoded = "reference.tokens".replace(
      /[^a-z0-9]/g,
      (character) => `_${character.charCodeAt(0).toString(16)}_`,
    );
    expect(`capsule_${encoded}`).toBe("capsule_reference_2e_tokens");
  });
});
