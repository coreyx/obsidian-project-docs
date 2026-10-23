import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The `obsidian` package holds type declarations only; Obsidian supplies the module at runtime.
    // Unit tests get a small stand-in with just the parts the plugin's logic touches.
    alias: { obsidian: fileURLToPath(new URL("./test/mocks/obsidian.ts", import.meta.url)) },
  },
  test: {
    include: ["test/unit/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // main.ts only wires components to Obsidian; the end-to-end tests cover it.
      exclude: ["src/main.ts"],
      thresholds: {
        lines: 80,
        branches: 70,
        // Privacy code decides what may reach the repo, so it is held to the critical-logic bar.
        "src/privacy/**": { lines: 90, branches: 85 },
      },
    },
  },
});
