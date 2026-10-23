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
  {
    // Test and build code isn't shipped in the plugin: it may log, and TypeScript, not ESLint,
    // checks that names such as Mocha's globals exist.
    files: ["test/**", "*.mjs", "*.mts"],
    rules: {
      "no-console": "off",
      "obsidianmd/rule-custom-message": "off",
      "no-undef": "off",
      // The DOM helpers' stand-ins are built from the plain DOM they stand in for.
      "obsidianmd/prefer-create-el": "off",
      // Tests build plain objects shaped like files.
      "obsidianmd/no-tfile-tfolder-cast": "off",
    },
  },
]);
