import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type { Confirmations } from "../../src/privacy/confirmations.js";
import { RuleIndicator, displayOf } from "../../src/rules/indicator.js";
import { RuleChanger } from "../../src/rules/menu.js";
import { DEFAULT_SETTINGS, type DisplaySettings } from "../../src/settings.js";
import { MarkdownView, Menu, TFile } from "../mocks/obsidian.js";
import { MemoryVault, PROJECT, fixedProjects } from "./helpers.js";

/** The vault's copy of the docs folder: the project folder mirrors the repo. */
const P = `${PROJECT.folder}/docs`;
let frontmatter: Record<string, Record<string, unknown>>;
let active: TFile | null;
let views: MarkdownView[];
let status: HTMLElement;
let indicator: RuleIndicator;
let menus: Menu[];
let settings: DisplaySettings;
const showAtMouseEvent = Menu.prototype.showAtMouseEvent;

beforeEach(() => {
  frontmatter = {};
  active = null;
  views = [];
  menus = [];
  settings = { ...DEFAULT_SETTINGS };
  const app = {
    vault: new MemoryVault(),
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
    workspace: {
      getActiveFile: () => active,
      getLeavesOfType: () => views.map((view) => ({ view })),
    },
  } as unknown as App;
  const rules = new RuleChanger(app, fixedProjects(), {} as Confirmations, async () => true);
  // Records each menu the indicator opens, instead of showing it.
  Menu.prototype.showAtMouseEvent = function (this: Menu) {
    menus.push(this);
    return this;
  };
  status = document.body.createDiv();
  indicator = new RuleIndicator(app, rules, status, () => settings);
});
afterEach(() => {
  Menu.prototype.showAtMouseEvent = showAtMouseEvent;
  document.body.empty();
});

describe("the status bar item (REQ-9.0.1, 9.0.3)", () => {
  it("shows a note outside what the project syncs as vault only (TASK-18)", () => {
    active = new TFile(`${PROJECT.folder}/scratch.md`);
    indicator.refresh();
    expect(status.textContent).toBe("Vault only");
    expect(status.querySelector<HTMLElement>(".project-docs-rule-icon")?.dataset.icon).toBe(
      "unlink",
    );
    status.click();
    expect(menus[0]?.items.map((i) => i.title)).toEqual([
      "Vault only: outside the folders this project syncs",
    ]);
  });

  it("shows the active note's rule, and opens the choices when clicked", () => {
    active = new TFile(`${P}/guide.md`);
    frontmatter[`${P}/guide.md`] = { "project-docs": "repo-to-vault" };
    indicator.refresh();
    expect(status.textContent).toBe("Repo to vault only");
    expect(status.querySelector<HTMLElement>(".project-docs-rule-icon")?.dataset.icon).toBe(
      "arrow-down",
    );
    expect(status.classList.contains("project-docs-hidden")).toBe(false);
    status.click();
    expect(menus[0]?.items.find((i) => i.checked)?.title).toBe("Sync rule: Repo to vault only");
  });

  it("hides for notes outside every project, and with no note open", () => {
    active = new TFile("Elsewhere/a.md");
    indicator.refresh();
    expect(status.classList.contains("project-docs-hidden")).toBe(true);
    active = null;
    indicator.refresh();
    expect(status.textContent).toBe("");
    status.click();
    expect(menus).toEqual([]);
  });
});

describe("the header action (REQ-9.0.1)", () => {
  it("is added to every open project note, and follows rule changes", () => {
    const guide = new MarkdownView(new TFile(`${P}/guide.md`));
    const outside = new MarkdownView(new TFile("Elsewhere/a.md"));
    views = [guide, outside];
    indicator.refresh();
    expect(guide.actions.map((a) => a.title)).toEqual(["Sync rule: Sync both ways"]);
    expect(outside.actions).toEqual([]);

    frontmatter[`${P}/guide.md`] = { "project-docs": "private" };
    indicator.refresh();
    expect(guide.actions).toHaveLength(1);
    expect(guide.actions[0]?.el.dataset.icon).toBe("lock");
    expect(guide.actions[0]?.el.getAttribute("aria-label")).toBe("Sync rule: Private, vault only");

    guide.actions[0]?.callback(new MouseEvent("click"));
    expect(menus[0]?.items.find((i) => i.checked)?.title).toBe("Sync rule: Private, vault only");
  });

  it("is replaced when the view shows another note, and removed when it leaves projects", () => {
    const view = new MarkdownView(new TFile(`${P}/a.md`));
    views = [view];
    indicator.refresh();
    const first = view.actions[0]?.el;
    view.file = new TFile(`${P}/b.md`);
    indicator.refresh();
    expect(first?.isConnected).toBe(false);
    expect(view.actions).toHaveLength(2);
    view.file = new TFile("Elsewhere/c.md");
    indicator.refresh();
    expect(view.actions[1]?.el.isConnected).toBe(false);
  });

  it("goes with its view when the view closes, and everything goes on clear", () => {
    const view = new MarkdownView(new TFile(`${P}/a.md`));
    views = [view];
    active = new TFile(`${P}/a.md`);
    indicator.refresh();
    views = [];
    indicator.refresh();
    expect(view.actions[0]?.el.isConnected).toBe(false);

    views = [new MarkdownView(new TFile(`${P}/b.md`))];
    indicator.refresh();
    indicator.clear();
    expect(views[0]?.actions[0]?.el.isConnected).toBe(false);
    expect(status.textContent).toBe("");
  });
});

describe("the display settings (TASK-16)", () => {
  it("hides the status bar item and the header actions when they're turned off", () => {
    const view = new MarkdownView(new TFile(`${P}/guide.md`));
    views = [view];
    active = new TFile(`${P}/guide.md`);
    settings.ruleInStatusBar = false;
    settings.ruleInHeader = false;
    indicator.refresh();
    expect(status.classList.contains("project-docs-hidden")).toBe(true);
    expect(status.textContent).toBe("");
    expect(view.actions).toEqual([]);

    settings.ruleInHeader = true;
    indicator.refresh();
    expect(view.actions).toHaveLength(1);
    settings.ruleInHeader = false;
    indicator.refresh();
    expect(view.actions[0]?.el.isConnected).toBe(false);
    expect(status.classList.contains("project-docs-hidden")).toBe(true);
  });
});

describe("displayOf", () => {
  it("names an unknown rule as such", () => {
    expect(displayOf("invalid")).toEqual({ icon: "alert-triangle", label: "Unknown sync rule" });
  });
});
