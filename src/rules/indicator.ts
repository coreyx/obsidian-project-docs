/**
 * The current note's sync rule, always visible (REQ-9.0.1, 9.0.3, TASK-9): in the status bar for
 * the active note, and as an action in the header of every open project note. Clicking either
 * opens the same choices as the file menu, with the same confirmation.
 */
import { MarkdownView, Menu, setIcon, setTooltip, type App, type TFile } from "obsidian";
import { DEFAULT_SETTINGS, type DisplaySettings } from "../settings.js";
import { RULE_ICONS, RULE_LABELS, VAULT_ONLY, type RuleChanger } from "./menu.js";
import type { ProjectFile } from "../projects.js";

/** How a note's rule is shown: an icon and a label. */
export interface RuleDisplay {
  readonly icon: string;
  readonly label: string;
}

/** The display of a rule, or of a value Project Docs doesn't know. */
export function displayOf(rule: ReturnType<RuleChanger["cachedRuleOf"]>): RuleDisplay {
  return rule === "invalid"
    ? { icon: "alert-triangle", label: "Unknown sync rule" }
    : { icon: RULE_ICONS[rule], label: RULE_LABELS[rule] };
}

/** How a project note is shown: its rule, or vault only when the project doesn't sync it. */
function shownFor(rules: RuleChanger, file: TFile, place: ProjectFile): RuleDisplay {
  return rules.syncs(place) ? displayOf(rules.cachedRuleOf(file)) : VAULT_ONLY;
}

/** Keeps the status bar item and the header actions in step with each note's rule. */
export class RuleIndicator {
  /** Each Markdown view's header action, and the file it was made for. */
  private readonly actions = new Map<MarkdownView, { el: HTMLElement; path: string }>();

  constructor(
    private readonly app: App,
    private readonly rules: RuleChanger,
    private readonly statusEl: HTMLElement,
    private readonly display: () => DisplaySettings = () => DEFAULT_SETTINGS,
  ) {
    statusEl.addClass("project-docs-rule", "mod-clickable");
    statusEl.addEventListener("click", (evt) => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.openChoices(evt, file);
    });
  }

  /** Brings the status bar item and every header action up to date. */
  refresh(): void {
    this.refreshStatus();
    const open = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) {
        open.add(leaf.view);
        this.refreshAction(leaf.view);
      }
    }
    for (const [view, action] of this.actions) {
      if (!open.has(view)) {
        action.el.remove();
        this.actions.delete(view);
      }
    }
  }

  /** Removes everything the indicator added, as the plugin unloads. */
  clear(): void {
    for (const action of this.actions.values()) action.el.remove();
    this.actions.clear();
    this.statusEl.empty();
  }

  private refreshStatus(): void {
    const file = this.app.workspace.getActiveFile();
    const place = file && this.display().ruleInStatusBar ? this.rules.placeOf(file) : null;
    this.statusEl.empty();
    this.statusEl.toggleClass("project-docs-hidden", !place);
    if (!file || !place) return;
    const { icon, label } = shownFor(this.rules, file, place);
    setIcon(this.statusEl.createSpan({ cls: "project-docs-rule-icon" }), icon);
    this.statusEl.createSpan({ text: label });
    setTooltip(
      this.statusEl,
      this.rules.syncs(place)
        ? "Project Docs sync rule. Click to change it."
        : "Project Docs doesn't sync this note: it's outside the folders the project syncs.",
      { placement: "top" },
    );
  }

  private refreshAction(view: MarkdownView): void {
    const file = view.file;
    const place = file && this.display().ruleInHeader ? this.rules.placeOf(file) : null;
    const existing = this.actions.get(view);
    if (!file || !place) {
      existing?.el.remove();
      this.actions.delete(view);
      return;
    }
    const { icon, label } = shownFor(this.rules, file, place);
    const title = `Sync rule: ${label}`;
    if (existing && existing.path === file.path) {
      setIcon(existing.el, icon);
      existing.el.setAttribute("aria-label", title);
      return;
    }
    existing?.el.remove();
    const el = view.addAction(icon, title, (evt) => {
      if (view.file) this.openChoices(evt, view.file);
    });
    this.actions.set(view, { el, path: file.path });
  }

  private openChoices(evt: MouseEvent, file: TFile): void {
    const menu = new Menu();
    this.rules.addItems(menu, file);
    menu.showAtMouseEvent(evt);
  }
}
