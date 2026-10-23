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

  it("registers the decoded view and its command, and does nothing in a vault with no project", async function () {
    const registered = await browser.executeObsidian(({ app }) => {
      const internals = app as unknown as {
        commands: { commands: Record<string, unknown> };
        viewRegistry: { viewByType: Record<string, unknown> };
      };
      return {
        command: "project-docs:toggle-decoded-view" in internals.commands.commands,
        view: "project-docs-decoded" in internals.viewRegistry.viewByType,
        statusItems: [...document.querySelectorAll(".status-bar-item")]
          .filter((el) => !el.classList.contains("project-docs-hidden"))
          .map((el) => el.textContent ?? "")
          .filter((text) => text.includes("Project Docs")),
      };
    });
    expect(registered).toEqual({ command: true, view: true, statusItems: [] });
  });
});
