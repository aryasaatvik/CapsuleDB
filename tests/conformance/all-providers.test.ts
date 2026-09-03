import { describe, it } from "@effect/vitest";

import { runProviderSuite } from "./provider-suite.ts";
import { providerCases } from "../providers/cases.ts";

describe("shared CapsuleDB provider conformance", () => {
  for (const provider of providerCases) {
    it.effect(
      `${provider.name} satisfies the shared lifecycle and token contract`,
      () => provider.withClient((client) => runProviderSuite(provider, client)),
      provider.profile.dialect === "postgres" ? 60_000 : 30_000,
    );
  }
});
