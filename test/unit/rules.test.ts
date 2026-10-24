import { beforeEach, describe, expect, it } from "vitest";
import type { Menu as ObsidianMenu, TFile } from "obsidian";
import { FrontmatterError } from "@specdevship/project-docs-core/rules";
import type { Confirmations } from "../../src/privacy/confirmations.js";
import type { Project } from "../../src/projects.js";
import { ConfirmUnprivateModal, confirmUnprivate } from "../../src/rules/confirm-modal.js";
import { RuleChanger } from "../../src/rules/menu.js";
import { Menu, Modal, Notice, Setting } from "../mocks/obsidian.js";
import { MemoryVault, PROJECT, appWith, fixedProjects } from "./helpers.js";

/** The vault's copy of the docs folder: the project folder mirrors the repo. */
const P = `${PROJECT.folder}/docs`;
let vault: MemoryVault;
let confirmed: { project: Project; key: string; text: string }[];
let asked: { name: string; repoPath: string | null }[];
let answer: boolean;
let frontmatter: Record<string, Record<string, unknown>>;
let rules: RuleChanger;

const confirmations = {
  confirm: async (project: Project, key: string, text: string) => {
    confirmed.push({ project, key, text });
  },
} as unknown as Confirmations;

function changer(project: Project = PROJECT): RuleChanger {
  const app = appWith(vault, {
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
  });
  return new RuleChanger(app, fixedProjects([project]), confirmations, async (name, repoPath) => {
    asked.push({ name, repoPath });
    return answer;
  });
}

beforeEach(() => {
  vault = new MemoryVault();
  confirmed = [];
  asked = [];
  answer = true;
  frontmatter = {};
  rules = changer();
  Notice.shown = [];
  Modal.opened = [];
  Setting.buttons = [];
});

describe("RuleChanger.setRule (REQ-9.0.2, 9.2)", () => {
  it("writes only the project-docs property", async () => {
    vault.texts.set(`${P}/guide.md`, "---\ntitle: Guide\n---\nBody\n");
    expect(await rules.setRule(vault.file(`${P}/guide.md`), "repo-to-vault")).toBe("changed");
    expect(vault.texts.get(`${P}/guide.md`)).toBe(
      "---\ntitle: Guide\nproject-docs: repo-to-vault\n---\nBody\n",
    );
  });

  it("makes a note private without asking", async () => {
    vault.texts.set(`${P}/guide.md`, "Body\n");
    expect(await rules.setRule(vault.file(`${P}/guide.md`), "private")).toBe("changed");
    expect(asked).toEqual([]);
    expect(confirmed).toEqual([]);
  });

  it("does nothing when the rule is already set", async () => {
    vault.texts.set(`${P}/guide.md`, "Body\n");
    expect(await rules.setRule(vault.file(`${P}/guide.md`), "sync")).toBe("unchanged");
    expect(vault.writes).toEqual([]);
  });

  it("asks before making a private note syncable, naming where it goes (REQ-9.3)", async () => {
    vault.texts.set(`${P}/plan.md`, "---\nproject-docs: private\n---\nplan\n");
    expect(await rules.setRule(vault.file(`${P}/plan.md`), "sync")).toBe("changed");
    expect(asked).toEqual([{ name: "plan.md", repoPath: "docs/plan.md" }]);
    expect(vault.texts.get(`${P}/plan.md`)).toBe("---\nproject-docs: sync\n---\nplan\n");
  });

  it("records the confirmation with the note's new text, so VS Code doesn't ask again (REQ-10.6)", async () => {
    vault.texts.set(`${P}/plan.md`, "---\nproject-docs: private\n---\nplan\n");
    await rules.setRule(vault.file(`${P}/plan.md`), "repo-only");
    expect(confirmed).toEqual([
      { project: PROJECT, key: "docs/plan.md", text: "---\nproject-docs: repo-only\n---\nplan\n" },
    ]);
  });

  it("leaves the note private when the question is declined", async () => {
    answer = false;
    const text = "---\nproject-docs: private\n---\nplan\n";
    vault.texts.set(`${P}/plan.md`, text);
    expect(await rules.setRule(vault.file(`${P}/plan.md`), "sync")).toBe("cancelled");
    expect(vault.texts.get(`${P}/plan.md`)).toBe(text);
    expect(confirmed).toEqual([]);
  });

  it("names the repo path as unknown while the repo can't be read", async () => {
    rules = changer({ ...PROJECT, docsFolder: null, privateFolder: null, reachable: false });
    vault.texts.set(`${P}/plan.md`, "---\nproject-docs: private\n---\n");
    await rules.setRule(vault.file(`${P}/plan.md`), "sync");
    expect(asked[0]?.repoPath).toBeNull();
  });

  it("offers a note in the private folder no rule but private (REQ-10.0.1)", async () => {
    vault.texts.set(`${P}/private/a.md`, "---\nproject-docs: private\n---\n");
    expect(await rules.setRule(vault.file(`${P}/private/a.md`), "sync")).toBe("unavailable");
    expect(asked).toEqual([]);
  });

  it.each([
    ["outside every project", "Elsewhere/a.md"],
    ["the link note", PROJECT.linkNotePath],
    ["an attachment", `${P}/shot.png`],
  ])("refuses a file %s", async (_name, path) => {
    vault.texts.set(path, "x\n");
    expect(await rules.setRule(vault.file(path), "private")).toBe("unavailable");
  });

  it("treats an invalid rule as not private, and replaces it", async () => {
    vault.texts.set(`${P}/a.md`, "---\nproject-docs: typo\n---\n");
    expect(await rules.setRule(vault.file(`${P}/a.md`), "sync")).toBe("changed");
    expect(asked).toEqual([]);
  });

  it("says so when the frontmatter can't be edited, and rethrows anything else", async () => {
    vault.texts.set(`${P}/a.md`, "x\n");
    vault.failNext = new FrontmatterError("bad");
    expect(await rules.choose(vault.file(`${P}/a.md`), "private")).toBe("unreadable");
    expect(Notice.shown[0]).toMatch(/can't change the sync rule of a\.md/);
    vault.failNext = new Error("disk full");
    await expect(rules.setRule(vault.file(`${P}/a.md`), "private")).rejects.toThrow("disk full");
  });
});

describe("RuleChanger.addItems (REQ-9.1)", () => {
  const items = (path: string) => {
    const menu = new Menu();
    rules.addItems(menu as unknown as ObsidianMenu, vault.file(path));
    return menu.items;
  };

  it("adds every rule, the current one checked, one click from the menu", async () => {
    frontmatter[`${P}/guide.md`] = { "project-docs": "repo-only" };
    vault.texts.set(`${P}/guide.md`, "---\nproject-docs: repo-only\n---\n");
    const added = items(`${P}/guide.md`);
    expect(added.map((i) => [i.title, i.checked])).toEqual([
      ["Sync rule: Sync both ways", false],
      ["Sync rule: Repo to vault only", false],
      ["Sync rule: Repo only", true],
      ["Sync rule: Private, vault only", false],
    ]);
    added[3]?.handler?.();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(vault.texts.get(`${P}/guide.md`)).toBe("---\nproject-docs: private\n---\n");
  });

  it("checks sync for a note with no rule, and none for an invalid one", () => {
    expect(items(`${P}/plain.md`).find((i) => i.checked)?.title).toBe("Sync rule: Sync both ways");
    frontmatter[`${P}/odd.md`] = { "project-docs": "typo" };
    expect(items(`${P}/odd.md`).some((i) => i.checked)).toBe(false);
  });

  it("offers only private in the private folder, and nothing outside projects", () => {
    expect(items(`${P}/private/a.md`).map((i) => i.title)).toEqual([
      "Sync rule: Private, vault only",
    ]);
    expect(items("Elsewhere/a.md")).toEqual([]);
  });

  it("shows a note outside what the project syncs as vault only, with no rule (TASK-18)", async () => {
    const outside = `${PROJECT.folder}/scratch.md`;
    expect(items(outside).map((i) => [i.title, i.disabled, i.handler])).toEqual([
      ["Vault only: outside the folders this project syncs", true, undefined],
    ]);
    vault.texts.set(outside, "scratch\n");
    expect(await rules.setRule(vault.file(outside), "repo-only")).toBe("unavailable");
    expect(vault.texts.get(outside)).toBe("scratch\n");
  });

  it("offers the rules on a root file the project lists (TASK-18)", () => {
    expect(items(`${PROJECT.folder}/README.md`)).toHaveLength(4);
  });
});

describe("ConfirmUnprivateModal", () => {
  it("names the note and the repo path, and answers yes only to its button", async () => {
    const answer = confirmUnprivate({} as never, "plan.md", "docs/plan.md");
    const modal = Modal.opened[0] as unknown as ConfirmUnprivateModal & { title: string };
    expect(modal.title).toBe("Sync this note to the repo?");
    expect(modal.contentEl.textContent).toContain("plan.md is private");
    expect(modal.contentEl.textContent).toContain("as docs/plan.md");
    expect(Setting.buttons.map((b) => [b.text, b.destructive])).toEqual([
      ["Sync to repo", true],
      ["Cancel", false],
    ]);
    Setting.buttons[0]?.click();
    expect(await answer).toBe(true);
  });

  it("answers no when cancelled or closed, once", async () => {
    const cancelled = confirmUnprivate({} as never, "a.md", null);
    Setting.buttons[1]?.click();
    expect(await cancelled).toBe(false);

    const closed = confirmUnprivate({} as never, "b.md", null);
    const modal = Modal.opened[1] as unknown as ConfirmUnprivateModal;
    expect(modal.contentEl.textContent).not.toContain(" as ");
    modal.close();
    modal.close();
    expect(await closed).toBe(false);
  });
});
