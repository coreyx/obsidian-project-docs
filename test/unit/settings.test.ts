import { describe, expect, it } from "vitest";
import type { SettingDefinition, SettingDefinitionGroup } from "obsidian";
import {
  DEFAULT_SETTINGS,
  ProjectDocsSettingTab,
  projectFacts,
  readSettings,
  type SettingsHost,
} from "../../src/settings.js";
import { PROJECT, fixedProjects } from "./helpers.js";

/** A tab on a plugin that knows `projects`, and how many times it saved. */
function tabFor(projects = [PROJECT]) {
  const host = {
    displaySettings: { ...DEFAULT_SETTINGS },
    projects: fixedProjects(projects),
    saves: 0,
    async saveSettings() {
      this.saves++;
    },
  };
  const tab = new ProjectDocsSettingTab({} as never, host as unknown as SettingsHost);
  const groups = () => tab.getSettingDefinitions() as SettingDefinitionGroup[];
  const names = (group: SettingDefinitionGroup | undefined) =>
    (group?.items as SettingDefinition[] | undefined)?.map((item) => item.name);
  return { host, tab, groups, names };
}

describe("readSettings", () => {
  it("starts with everything shown", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps saved true or false values, and defaults anything else", () => {
    expect(readSettings({ banners: false, ruleInHeader: "no", extra: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      banners: false,
    });
  });
});

describe("projectFacts", () => {
  it("lists the repo, docs folder, private folder and attachment sync", () => {
    expect(projectFacts(PROJECT)).toEqual([
      "Repo: /src/api",
      "Docs folder in the repo: docs",
      "Root files: README.md, CHANGELOG.md, RELEASE_NOTES.md",
      "Private folder: docs/private",
      "Attachment sync: on",
    ]);
  });

  it("says when no root files sync, and leaves them out for a repo-root link (TASK-18)", () => {
    expect(projectFacts({ ...PROJECT, rootFiles: [] })[2]).toBe("Root files: none");
    expect(projectFacts({ ...PROJECT, docsFolder: "", privateFolder: "private" })).toEqual([
      "Repo: /src/api",
      "Docs folder in the repo: the repo root",
      "Private folder: private",
      "Attachment sync: on",
    ]);
  });

  it("says when the repo can't be read", () => {
    const facts = projectFacts({
      ...PROJECT,
      reachable: false,
      docsFolder: null,
      privateFolder: null,
      rootFiles: [],
      syncAttachments: false,
    });
    expect(facts).toEqual([
      "Repo: /src/api",
      "The repo can't be read right now, so the plugin uses the settings that protect the most.",
      "Private folder: private, inside the docs folder",
      "Attachment sync: off",
    ]);
  });
});

describe("the settings tab (TASK-16)", () => {
  it("lists each linked project read-only, with its settings", () => {
    const root = { ...PROJECT, folder: "" };
    const { groups, names } = tabFor([PROJECT, root]);
    const [projects] = groups();
    expect(projects?.heading).toBe("Linked projects");
    expect(names(projects)).toEqual([
      "Where these settings live",
      "Projects/api",
      "The vault's root folder",
    ]);
    const api = (projects?.items as SettingDefinition[])[1];
    expect(api && "control" in api).toBe(false);
    expect((api?.desc as DocumentFragment).textContent).toContain("Repo: /src/api");
  });

  it("says how to link a project when there's none", () => {
    const { groups, names } = tabFor([]);
    expect(names(groups()[0])).toEqual(["Where these settings live", "No linked projects"]);
  });

  it("offers a toggle for each display, then a note on the decoded view", () => {
    const { groups, names } = tabFor();
    const display = groups()[1];
    expect(display?.heading).toBe("Display");
    expect(names(display)).toEqual([
      "Sync rule in the status bar",
      "Sync rule icon in note headers",
      "Sync status in the status bar",
      "Banners on notes",
      "Decoded view",
    ]);
    const keys = (display?.items as SettingDefinition[]).map((item) =>
      "control" in item && item.control ? [item.control.type, item.control.key] : null,
    );
    expect(keys).toEqual([
      ["toggle", "ruleInStatusBar"],
      ["toggle", "ruleInHeader"],
      ["toggle", "statusInStatusBar"],
      ["toggle", "banners"],
      null,
    ]);
  });

  it("reads and saves the toggles on the plugin's display settings", async () => {
    const { host, tab } = tabFor();
    expect(tab.getControlValue("banners")).toBe(true);
    await tab.setControlValue("banners", false);
    expect(host.displaySettings.banners).toBe(false);
    expect(tab.getControlValue("banners")).toBe(false);
    expect(host.saves).toBe(1);
  });

  it("ignores keys and values that aren't display settings", async () => {
    const { host, tab } = tabFor();
    expect(tab.getControlValue("toString")).toBeUndefined();
    await tab.setControlValue("toString", false);
    await tab.setControlValue("banners", "no");
    expect(host.displaySettings).toEqual(DEFAULT_SETTINGS);
    expect(host.saves).toBe(0);
  });
});
