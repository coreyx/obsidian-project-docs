// End-to-end tests in a real, sandboxed Obsidian (wdio-obsidian-service). Each run tests the
// manifest's minAppVersion ("earliest") and the latest release, with the plugin built into main.js.
import * as path from "node:path";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

// Downloaded Obsidian versions are kept here, and cached between CI runs.
const cacheDir = path.resolve(".obsidian-cache");

const versions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest",
  { cacheDir },
);
if (env.CI) {
  // CI uses this line, the resolved versions, as the key of the Obsidian download cache.
  console.log("obsidian-cache-key:", JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./test/e2e/**/*.e2e.ts"],
  maxInstances: Number(env.WDIO_MAX_INSTANCES || 2),
  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: "obsidian",
    "wdio:obsidianOptions": {
      appVersion,
      installerVersion,
      plugins: ["."],
      vault: "test/e2e/vault",
    },
  })),
  services: ["obsidian"],
  reporters: ["obsidian"],
  cacheDir,
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  logLevel: "warn",
};
