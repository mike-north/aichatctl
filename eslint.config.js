// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/temp/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".claude/worktrees/**",
      "plugins/**",
      "packages/sdk/docs/**",
      "packages/sdk/api-report/**",
      "eslint.config.js",
      "vitest.config.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-plusplus": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test-d.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  prettier,
);
