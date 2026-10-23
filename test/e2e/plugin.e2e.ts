import { browser, expect } from "@wdio/globals";

describe("the plugin", function () {
  before(async function () {
    await browser.reloadObsidian({ vault: "./test/e2e/vault" });
  });

  it("loads in Obsidian", async function () {
    const loaded = await browser.executeObsidian(
      ({ app }) =>
        // `plugins` isn't part of Obsidian's public types.
        (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins[
          "project-docs"
        ] !== undefined,
    );
    expect(loaded).toBe(true);
  });
});
