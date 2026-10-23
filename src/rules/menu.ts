/**
 * Changing a note's sync rule with the mouse (REQ-9.0.2, 9.1, 9.3, TASK-8). The rules appear as
 * items directly in the file menu, two clicks from the file. (Obsidian's API has no submenus, so
 * the plan's "Sync rule" submenu became a menu section.) Making a private note syncable asks first,
 * and records the user's answer so VS Code doesn't ask again (REQ-10.6).
 */
import { Notice, type App, type Menu, type TFile } from "obsidian";
import { inPrivateSubfolder } from "@specdevship/project-docs-core/guards";
import {
  FrontmatterError,
  SYNC_RULES,
  isInvalidRule,
  readRule,
  setRule,
  type SyncRule,
} from "@specdevship/project-docs-core/rules";
import type { Confirmations } from "../privacy/confirmations.js";
import type { ProjectFile, ProjectIndex } from "../projects.js";
import { confirmUnprivate } from "./confirm-modal.js";

/** How each rule is named in menus and the status bar. */
export const RULE_LABELS: Record<SyncRule, string> = {
  sync: "Sync both ways",
  "repo-to-vault": "Repo to vault only",
  "repo-only": "Repo only",
  private: "Private, vault only",
};

/** The icon shown for each rule. */
export const RULE_ICONS: Record<SyncRule, string> = {
  sync: "arrow-left-right",
  "repo-to-vault": "arrow-down",
  "repo-only": "git-branch",
  private: "lock",
};

/** What a rule change did. */
export type RuleChange = "changed" | "unchanged" | "cancelled" | "unavailable" | "unreadable";

/** Asks whether a private note may sync; the modal by default, a stand-in in tests. */
export type AskUnprivate = (noteName: string, repoPath: string | null) => Promise<boolean>;

/** Reads and changes notes' sync rules, and builds the menu items that do it. */
export class RuleChanger {
  private readonly ask: AskUnprivate;

  constructor(
    private readonly app: App,
    private readonly projects: ProjectIndex,
    private readonly confirmations: Confirmations,
    ask?: AskUnprivate,
  ) {
    this.ask = ask ?? ((name, repoPath) => confirmUnprivate(app, name, repoPath));
  }

  /** A Markdown note's place in a project, unless it's outside them or the link note. */
  placeOf(file: TFile): ProjectFile | null {
    if (file.extension !== "md") return null;
    const place = this.projects.projectFor(file.path);
    return place && file.path !== place.project.linkNotePath ? place : null;
  }

  /**
   * The rules a note may be given. A note in the private folder is private whatever its
   * frontmatter says (REQ-10.0.1), so it's offered no other rule.
   */
  choicesFor(place: ProjectFile): readonly SyncRule[] {
    return inPrivateSubfolder(place.key, place.project.privateSubfolder) ? ["private"] : SYNC_RULES;
  }

  /** A note's current rule, or "invalid" when its frontmatter names an unknown one. */
  async ruleOf(file: TFile): Promise<SyncRule | "invalid"> {
    const rule = readRule(await this.app.vault.read(file));
    return isInvalidRule(rule) ? "invalid" : rule;
  }

  /** Sets a note's rule, asking first when that makes a private note syncable (REQ-9.0.4). */
  async setRule(file: TFile, rule: SyncRule): Promise<RuleChange> {
    const place = this.placeOf(file);
    if (!place || !this.choicesFor(place).includes(rule)) return "unavailable";
    const current = await this.ruleOf(file);
    if (current === rule) return "unchanged";
    const leavingPrivate = current === "private" && rule !== "private";
    if (leavingPrivate) {
      const { docsFolder } = place.project;
      const repoPath =
        docsFolder === null ? null : [docsFolder, place.key].filter(Boolean).join("/");
      if (!(await this.ask(file.name, repoPath))) return "cancelled";
    }
    let text: string;
    try {
      text = await this.app.vault.process(file, (before) => setRule(before, rule));
    } catch (error) {
      if (error instanceof FrontmatterError) return "unreadable";
      throw error;
    }
    if (leavingPrivate) await this.confirmations.confirm(place.project, place.key, text);
    return "changed";
  }

  /** Sets a rule from a menu, and says so when it couldn't be set. */
  async choose(file: TFile, rule: SyncRule): Promise<RuleChange> {
    const result = await this.setRule(file, rule);
    if (result === "unreadable") {
      new Notice(
        `Project Docs can't change the sync rule of ${file.name}: its frontmatter can't be edited safely. Fix it, then try again.`,
      );
    }
    return result;
  }

  /**
   * A note's rule as Obsidian's metadata cache knows it, for showing it at once. Changing a rule
   * reads the file itself.
   */
  cachedRuleOf(file: TFile): SyncRule | "invalid" {
    const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.["project-docs"];
    if (value === undefined || value === null) return "sync";
    return SYNC_RULES.find((rule) => rule === value) ?? "invalid";
  }

  /**
   * Adds the rule choices for a project note to a menu, the current rule checked. Obsidian builds
   * the file menu synchronously, so the current rule comes from the metadata cache.
   */
  addItems(menu: Menu, file: TFile): void {
    const place = this.placeOf(file);
    if (!place) return;
    const current = this.cachedRuleOf(file);
    for (const rule of this.choicesFor(place)) {
      menu.addItem((item) =>
        item
          .setSection("project-docs")
          .setTitle(`Sync rule: ${RULE_LABELS[rule]}`)
          .setIcon(RULE_ICONS[rule])
          .setChecked(current === rule)
          .onClick(() => void this.choose(file, rule)),
      );
    }
  }
}
