import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Syntactic linting only (no type-aware rules) to keep the run fast and
 * dependency-light. `tsc --noEmit` remains the type-correctness gate.
 * See ADR-0003.
 *
 * The `ui/` frontend is a separate application with its own `eslint.config.js`,
 * `tsconfig`, and `npm run lint` — excluded here so `npm run check` at the repo
 * root stays backend-only.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "**/dist/**",
      "node_modules/**",
      "coverage/**",
      "ui/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
