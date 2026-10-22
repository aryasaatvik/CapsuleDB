import { describe, expect, test } from "bun:test";
import { visibleStrings } from "../scripts/strings";

describe("claim audit", () => {
  const copy = [...visibleStrings().values()].flat().join("\n");

  test("no speed, security, adoption, or universal claims", () => {
    for (const phrase of [
      /\bfast(?:er|est)?\b/i,
      /\bblazing\b/i,
      /\bsecure\b/i,
      /\bproduction[- ]ready\b/i,
      /\bdownloads?\b/i,
      /\badopted\b/i,
      /\btrusted by\b/i,
      /\bzero[- ]config\b/i,
      /\bnever opens?\b/i,
      /\balways transactional\b/i,
    ]) {
      expect({ phrase: phrase.source, found: phrase.test(copy) }).toEqual({
        phrase: phrase.source,
        found: false,
      });
    }
  });

  test("sandboxing appears only as a denial", () => {
    for (const line of copy.split("\n").filter((text) => /sandbox/i.test(text))) {
      expect(line).toMatch(/(?:not|does not) sandbox/i);
    }
  });
});
