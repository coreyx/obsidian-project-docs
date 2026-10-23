/**
 * Where the engine's status shows in Obsidian (REQ-17.0.3, 17.2, TASK-10): the overall state in
 * the status bar, and a banner at the top of any open note the engine reports a problem with, such
 * as a change held back, a conflict, or a note that was private and waits for confirmation.
 */
import { MarkdownView, setIcon, setTooltip, type App, type TFile } from "obsidian";
import { DEFAULT_SETTINGS, type DisplaySettings } from "../settings.js";
import type { ProjectStatusItem, StatusReader, Summary } from "./reader.js";

/** The text and tooltip of the status bar item for a summary; null when it's hidden. */
export function summaryText(summary: Summary): { text: string; tooltip: string } | null {
  switch (summary.state) {
    case "none":
      return null;
    case "waiting":
      return {
        text: "Project Docs: not synced yet",
        tooltip: "Open the repo in VS Code, or run project-docs sync, to start syncing.",
      };
    case "idle":
      return { text: "Project Docs: up to date", tooltip: "Every linked note is in sync." };
    case "attention": {
      const count = summary.items.length;
      return {
        text: `Project Docs: ${count} ${count === 1 ? "needs" : "need"} attention`,
        tooltip: summary.items.map((item) => item.message).join("\n"),
      };
    }
  }
}

/** Confirms that a note which was private may sync; wired to the confirmation dialog. */
export type ConfirmSyncable = (file: TFile, item: ProjectStatusItem) => Promise<void>;

/** Keeps the status bar item and the banners in step with the engine's status. */
export class StatusDisplay {
  /** Each view's banner, and the items it shows, so an unchanged banner isn't rebuilt. */
  private readonly banners = new Map<MarkdownView, { el: HTMLElement; signature: string }>();

  constructor(
    private readonly app: App,
    private readonly status: StatusReader,
    private readonly statusEl: HTMLElement,
    private readonly confirmSyncable: ConfirmSyncable,
    private readonly display: () => DisplaySettings = () => DEFAULT_SETTINGS,
  ) {}

  /** Brings the status bar item and every banner up to date. */
  refresh(): void {
    const shown = this.display().statusInStatusBar ? summaryText(this.status.summary()) : null;
    this.statusEl.toggleClass("project-docs-hidden", shown === null);
    this.statusEl.empty();
    if (shown) {
      this.statusEl.setText(shown.text);
      setTooltip(this.statusEl, shown.tooltip, { placement: "top" });
    }
    const open = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) {
        open.add(leaf.view);
        this.refreshBanner(leaf.view);
      }
    }
    for (const [view, banner] of this.banners) {
      if (!open.has(view)) {
        banner.el.remove();
        this.banners.delete(view);
      }
    }
  }

  /** Removes everything the display added, as the plugin unloads. */
  clear(): void {
    for (const banner of this.banners.values()) banner.el.remove();
    this.banners.clear();
    this.statusEl.empty();
  }

  private refreshBanner(view: MarkdownView): void {
    const file = view.file;
    const items = file && this.display().banners ? this.status.itemsFor(file.path) : [];
    const signature = JSON.stringify([
      file?.path,
      items.map((i) => [i.kind, i.message, i.reasons, i.fix]),
    ]);
    const existing = this.banners.get(view);
    if (existing?.signature === signature) return;
    existing?.el.remove();
    this.banners.delete(view);
    if (!file || items.length === 0) return;
    const el = createDiv({ cls: "project-docs-banner" });
    for (const item of items) this.renderItem(el, file, item);
    view.contentEl.prepend(el);
    this.banners.set(view, { el, signature });
  }

  private renderItem(parent: HTMLElement, file: TFile, item: ProjectStatusItem): void {
    const row = parent.createDiv({ cls: "project-docs-banner-item" });
    setIcon(row.createSpan({ cls: "project-docs-banner-icon" }), "alert-circle");
    const body = row.createDiv({ cls: "project-docs-banner-body" });
    body.createDiv({ text: item.message });
    if (item.reasons.length > 0) {
      const list = body.createEl("ul");
      for (const reason of item.reasons) list.createEl("li", { text: reason });
    }
    if (item.fix === "confirm-syncable") {
      const button = row.createEl("button", { text: "Sync to repo…" });
      button.addEventListener("click", () => void this.confirmSyncable(file, item));
    }
  }
}
