/**
 * The decoded view (REQ-14.0.2 to 14.0.6, 15.0.5, TASK-11, design decision 14). A note header's
 * eye replaces the note, in the same tab, with a read-only view of the whole note decoded; the
 * view's own eye switches back. A fixed header and the status bar say which mode is showing
 * (REQ-14.0.4). Nothing is ever written: the view only renders.
 */
import {
  ItemView,
  Keymap,
  MarkdownView,
  TFile,
  setIcon,
  type App,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { PrivateMdMapping } from "@specdevship/project-docs-core/privatemd";
import type { ProjectIndex } from "../projects.js";
import { loadMapping, privateMdVersion, usesPrivateMd } from "./private-md.js";
import { renderDecoded, type RenderContext } from "./render.js";

export const DECODED_VIEW_TYPE = "project-docs-decoded";
/** The indicator text REQ-14.0.4 requires while real values show. */
export const DECODED_LABEL = "Decoded: real values shown";
/** How often an open decoded view checks whether PRIVATE.md changed. */
export const PRIVATE_MD_POLL_MS = 3_000;

/** Shown above a decoded note while PRIVATE.md's table is empty (REQ-15.0.6). */
export const NO_PLACEHOLDERS_NOTE =
  "PRIVATE.md has no placeholders yet, so the note shows as it is.";

/** Opens the decoded view of a note in a leaf, in place of what the leaf shows. */
export function openDecoded(leaf: WorkspaceLeaf, path: string): Promise<void> {
  return leaf.setViewState({ type: DECODED_VIEW_TYPE, state: { file: path }, active: true });
}

/** The read-only decoded view of one note. */
export class DecodedNoteView extends ItemView {
  private path: string | null = null;
  /** PRIVATE.md's modification time when last rendered, to redecode when it changes. */
  private privateMdAt: number | null = null;
  /** Counts renders, so a slow one finishing late doesn't replace a newer one. */
  private generation = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly projects: ProjectIndex,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DECODED_VIEW_TYPE;
  }

  override getIcon(): string {
    return "eye";
  }

  getDisplayText(): string {
    const name = this.path?.slice(this.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    return name ? `${name} (${DECODED_LABEL})` : DECODED_LABEL;
  }

  override getState(): Record<string, unknown> {
    return { file: this.path };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = (state as { file?: unknown } | null)?.file;
    this.path = typeof file === "string" ? file : null;
    await super.setState(state, result);
    await this.render();
  }

  override async onOpen(): Promise<void> {
    this.addAction("eye-off", "Show coded", () => void this.showCoded());
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.path) void this.render();
      }),
    );
    this.registerInterval(window.setInterval(() => void this.checkPrivateMd(), PRIVATE_MD_POLL_MS));
    // Links in rendered Markdown need a handler outside Obsidian's own editors.
    this.registerDomEvent(this.contentEl, "click", (evt) => {
      const link = (evt.target as HTMLElement | null)?.closest("a.internal-link");
      if (!link) return;
      evt.preventDefault();
      void this.app.workspace.openLinkText(
        link.getAttribute("data-href") ?? link.getAttribute("href") ?? "",
        this.path ?? "",
        Keymap.isModEvent(evt),
      );
    });
    await this.render();
  }

  /** Switches the tab back to the note itself. */
  async showCoded(): Promise<void> {
    if (!this.path) return;
    await this.leaf.setViewState({
      type: "markdown",
      state: { file: this.path, mode: "preview" },
      active: true,
    });
  }

  private async checkPrivateMd(): Promise<void> {
    const place = this.path ? this.projects.projectFor(this.path) : null;
    if (!place) return;
    if ((await privateMdVersion(place.project.repoPath)) !== this.privateMdAt) await this.render();
  }

  /** Renders the note decoded, or the reason nothing is shown (REQ-14.0.5). */
  async render(): Promise<void> {
    const generation = ++this.generation;
    const content = createDiv({ cls: "project-docs-decoded-view" });
    const header = content.createDiv({ cls: "project-docs-decoded-header" });
    setIcon(header.createSpan(), "eye");
    header.createSpan({ text: DECODED_LABEL });
    await this.renderInto(content);
    if (generation !== this.generation) return;
    this.contentEl.empty();
    this.contentEl.appendChild(content);
  }

  private async renderInto(content: HTMLElement): Promise<void> {
    const message = (text: string, cls = "project-docs-decoded-error") =>
      content.createDiv({ cls, text });
    const file = this.path ? this.app.vault.getAbstractFileByPath(this.path) : null;
    if (!(file instanceof TFile)) return void message("This note isn't in the vault any more.");
    const place = this.projects.projectFor(file.path);
    if (!place) return void message("This note isn't in a linked Project Docs folder.");
    const loaded = await loadMapping(place.project.repoPath);
    this.privateMdAt = await privateMdVersion(place.project.repoPath);
    if ("error" in loaded) return void message(`Nothing is decoded: ${loaded.error}.`);
    if (loaded.mapping.size === 0) message(NO_PLACEHOLDERS_NOTE, "project-docs-decoded-note");
    const body = content.createDiv();
    const result = await renderDecoded(
      renderContext(this.app, this, this.projects),
      body,
      file,
      await this.app.vault.read(file),
      loaded.mapping,
    );
    if (!result.complete) {
      body.remove();
      message(
        `Nothing is shown, because part of this note couldn't be decoded: ${result.remaining.join(", ")} would still show. That can happen in a note embedded from outside this project; open it on its own.`,
      );
    }
  }
}

/** Rendering's view of the vault: each note is decoded with its own project's mapping. */
function renderContext(app: App, owner: ItemView, projects: ProjectIndex): RenderContext {
  return {
    app,
    owner,
    async mappingFor(file: TFile): Promise<PrivateMdMapping | null> {
      const place = projects.projectFor(file.path);
      if (!place) return null;
      const loaded = await loadMapping(place.project.repoPath);
      return "mapping" in loaded ? loaded.mapping : null;
    },
  };
}

/** How long whether a repo uses PRIVATE.md is remembered before it's checked again. */
const DECODABLE_TTL_MS = 10_000;

/** Adds the decoded toggle to notes and keeps the status bar's mode up to date. */
export class DecodedViews {
  private readonly actions = new Map<MarkdownView, { el: HTMLElement; path: string }>();
  private readonly decodable = new Map<string, { value: boolean; at: number }>();

  constructor(
    private readonly app: App,
    private readonly projects: ProjectIndex,
    private readonly statusEl: HTMLElement,
  ) {
    statusEl.addClass("project-docs-mode", "mod-clickable");
    statusEl.addEventListener("click", () => void this.toggle());
  }

  /** True when the note is in a project whose repo uses PRIVATE.md. */
  async isDecodable(path: string): Promise<boolean> {
    const place = this.projects.projectFor(path);
    if (!place || !path.endsWith(".md") || path === place.project.linkNotePath) return false;
    const repo = place.project.repoPath;
    const known = this.decodable.get(repo);
    if (known && Date.now() - known.at < DECODABLE_TTL_MS) return known.value;
    const value = await usesPrivateMd(repo);
    this.decodable.set(repo, { value, at: Date.now() });
    return value;
  }

  /** Switches the active tab between a note and its decoded view. */
  async toggle(): Promise<void> {
    const leaf = this.app.workspace.getMostRecentLeaf();
    const view = leaf?.view;
    if (view instanceof DecodedNoteView) {
      await view.showCoded();
    } else if (
      leaf &&
      view instanceof MarkdownView &&
      view.file &&
      (await this.isDecodable(view.file.path))
    ) {
      await openDecoded(leaf, view.file.path);
    }
  }

  /** Brings the header toggles and the status bar's mode up to date. */
  async refresh(): Promise<void> {
    const open = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      open.add(leaf.view);
      await this.refreshAction(leaf, leaf.view);
    }
    for (const [view, action] of this.actions) {
      if (!open.has(view)) {
        action.el.remove();
        this.actions.delete(view);
      }
    }
    await this.refreshStatus();
  }

  /** Removes everything this added, as the plugin unloads. */
  clear(): void {
    for (const action of this.actions.values()) action.el.remove();
    this.actions.clear();
    this.statusEl.empty();
  }

  private async refreshAction(leaf: WorkspaceLeaf, view: MarkdownView): Promise<void> {
    const path = view.file?.path;
    const existing = this.actions.get(view);
    if (existing && existing.path === path) return;
    existing?.el.remove();
    this.actions.delete(view);
    if (!path || !(await this.isDecodable(path))) return;
    const el = view.addAction("eye", "Show decoded", () => {
      if (view.file) void openDecoded(leaf, view.file.path);
    });
    this.actions.set(view, { el, path });
  }

  private async refreshStatus(): Promise<void> {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    this.statusEl.empty();
    this.statusEl.removeClass("project-docs-mode-decoded");
    let text: string | null = null;
    if (view instanceof DecodedNoteView) {
      text = DECODED_LABEL;
      this.statusEl.addClass("project-docs-mode-decoded");
    } else if (
      view instanceof MarkdownView &&
      view.file &&
      (await this.isDecodable(view.file.path))
    ) {
      text = "Coded";
    }
    this.statusEl.toggleClass("project-docs-hidden", text === null);
    if (text) {
      setIcon(
        this.statusEl.createSpan({ cls: "project-docs-mode-icon" }),
        text === "Coded" ? "lock" : "eye",
      );
      this.statusEl.createSpan({ text });
    }
  }
}
