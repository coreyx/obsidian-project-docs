// The community plugin rules Obsidian's reviewers use, which include ESLint's and typescript-eslint's
// type-checked recommended sets.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/", "coverage/", ".obsidian-cache/", "test/e2e/vault*/"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs", "*.mts"] },
      },
    },
  },
]);
