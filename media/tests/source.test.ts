import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "../scripts/projects";
import { visibleStrings } from "../scripts/strings";
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

  test("readiness states and results match Registry and Readiness", () => {
    const union = read("src/Readiness.ts").match(
      /export const Readiness = Schema\.TaggedUnion\(\{([\s\S]*?)\n\}\);/,
    )?.[1];
    const tags = [...(union ?? "").matchAll(/^ {2}(\w+): \{/gm)].flatMap(([, tag]) => tag ?? []);
    expect(tags.toSorted()).toEqual(["Drift", "Pending", "Ready"]);
    const still = visibleStrings().get("readiness-still") ?? [];
    for (const tag of tags) expect(still).toContain(tag);

    // `status` reports every state; `prepare` and `assert` succeed only with `Ready`.
    const registry = read("src/Registry.ts");
    const signature = (name: string) =>
      registry.match(
        new RegExp(`export const ${name} = \\(\\s*options: [^)]*\\): Effect\\.Effect<(\\w+),`),
      )?.[1];
    expect(signature("status")).toBe("Readiness");
    expect(signature("prepare")).toBe("Ready");
    expect(signature("assert")).toBe("Ready");
    expect(registry).toContain('if (readiness._tag === "Ready") return readiness;');
  });

  test("first-use gates the client the capsule layers build with", () => {
    // The gated client is provided to the merged service layers, so a layer that queries while it
    // builds runs the check then; only success is remembered, so a failure is retried.
    expect(read("src/Registry.ts")).toMatch(
      /options\.readiness === "first-use"\s*\?\s*merged\.pipe\(\s*Layer\.provide\([\s\S]*?GatedClient\.make\(/,
    );
    expect(read("src/internal/gated-client.ts")).toMatch(
      /outsideTransaction\.pipe\(\s*Effect\.mapError\(asSqlError\),\s*Effect\.map\(\(\) => \{\s*ready = true;/,
    );
  });

  test("the reference namespace is the ID's derivation", () => {
    const encoded = "reference.tokens".replace(
      /[^a-z0-9]/g,
      (character) => `_${character.charCodeAt(0).toString(16)}_`,
    );
    expect(`capsule_${encoded}`).toBe("capsule_reference_2e_tokens");
  });
});
