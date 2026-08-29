import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  plugins: ["typescript", "import", "node"],
  rules: {
    "eslint/no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "vitest",
            message: "Import test helpers from @effect/vitest.",
          },
        ],
      },
    ],
    "eslint/no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
    "eslint/no-underscore-dangle": "off",
    "import/namespace": "off",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
  },
});
