/**
 * The Project Docs plugin's entry point (TASK-12): it wires the components together. Every event,
 * view, command and timer is registered through the plugin's register* methods, so unloading the
 * plugin removes all of them. The plugin never runs sync passes (design decision 8): the VS Code
 * extension and the command line do, and this plugin covers what happens inside Obsidian.
 */
import { Notice, Plugin, TFile } from "obsidian";
import { DECODED_VIEW_TYPE, DecodedNoteView, DecodedViews } from "./decode/view.js";
import { Confirmations } from "./privacy/confirmations.js";
import { PrivateMarker } from "./privacy/marker.js";
import { PrivateFilesList } from "./privacy/private-files.js";
import { ProjectIndex, SETTINGS_REFRESH_MS } from "./projects.js";
import { confirmUnprivate } from "./rules/confirm-modal.js";
import { RuleIndicator } from "./rules/indicator.js";
import { RuleChanger } from "./rules/menu.js";
import { StatusDisplay } from "./status/banner.js";
import { STATUS_POLL_MS, StatusReader, type ProjectStatusItem } from "./status/reader.js";

/** The plugin Obsidian loads from main.js. */
export default class ProjectDocsPlugin extends Plugin {
  projects!: ProjectIndex;
  private confirmations!: Confirmations;
  private marker!: PrivateMarker;
  private privateFiles!: PrivateFilesList;
  private rules!: RuleChanger;
  private indicator!: RuleIndicator;
  private status!: StatusReader;
  private statusDisplay!: StatusDisplay;
  private decoded!: DecodedViews;

  override onload(): void {
    this.projects = new ProjectIndex(this.app);
    this.confirmations = new Confirmations(this.app);
    this.marker = new PrivateMarker(this.app, this.projects);
    this.privateFiles = new PrivateFilesList(this.app, this.projects, (project) => {
      new Notice(
        `Project Docs can't read the private-files list in ${project.folder}/.project-docs. Attachments there don't sync until it's fixed or deleted.`,
      );
    });
    this.rules = new RuleChanger(this.app, this.projects, this.confirmations);
    this.status = new StatusReader(this.app, this.projects);
    this.indicator = new RuleIndicator(this.app, this.rules, this.addStatusBarItem());
    this.statusDisplay = new StatusDisplay(
      this.app,
      this.status,
      this.addStatusBarItem(),
      (file, item) => this.confirmSyncable(file, item),
    );
    this.decoded = new DecodedViews(this.app, this.projects, this.addStatusBarItem());

    this.registerView(DECODED_VIEW_TYPE, (leaf) => new DecodedNoteView(leaf, this.projects));
    this.addCommand({
      id: "toggle-decoded-view",
      name: "Toggle decoded view",
      callback: () => void this.decoded.toggle(),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile) this.rules.addItems(menu, file);
      }),
    );
    // Vault create events also fire for every existing file while Obsidian loads, so the vault
    // is watched only once the layout is ready, after a sweep for what arrived while it was closed.
    this.app.workspace.onLayoutReady(() => void this.start());
  }

  override onunload(): void {
    this.indicator.clear();
    this.statusDisplay.clear();
    this.decoded.clear();
  }

  private async start(): Promise<void> {
    await this.projects.refresh();
    const { vault, metadataCache, workspace } = this.app;
    this.registerEvent(
      vault.on("create", (file) => {
        void this.marker.onCreateOrRename(file);
        void this.privateFiles.onCreate(file);
      }),
    );
    this.registerEvent(
      vault.on("rename", (file, oldPath) => {
        void this.marker.onCreateOrRename(file);
        void this.privateFiles.onRename(file, oldPath);
        this.refreshViews();
      }),
    );
    this.registerEvent(vault.on("modify", (file) => void this.privateFiles.onModify(file)));
    this.registerEvent(
      metadataCache.on("changed", (file, _data, cache) => {
        if (this.projects.affects(file, cache)) void this.projects.refresh();
        this.refreshViews();
      }),
    );
    this.registerEvent(this.projects.on("changed", () => void this.sweep()));
    this.registerEvent(
      this.status.on("changed", () => {
        this.statusDisplay.refresh();
        void this.pruneConfirmations();
      }),
    );
    for (const name of ["active-leaf-change", "file-open", "layout-change"] as const) {
      this.registerEvent(workspace.on(name as "layout-change", () => this.refreshViews()));
    }
    this.registerInterval(
      window.setInterval(() => void this.projects.refresh(), SETTINGS_REFRESH_MS),
    );
    this.registerInterval(window.setInterval(() => void this.status.refresh(), STATUS_POLL_MS));
    await this.sweep();
    await this.status.refresh();
    this.refreshViews();
  }

  /** Marks and records what's in every private folder, and says what couldn't be marked. */
  private async sweep(): Promise<void> {
    const failed = await this.marker.sweep();
    if (failed.length > 0) {
      new Notice(
        `Project Docs couldn't mark ${failed.length === 1 ? failed[0]?.path : `${failed.length} notes`} private, because the frontmatter can't be edited safely. The private folder still keeps ${failed.length === 1 ? "it" : "them"} out of the repo.`,
      );
    }
    await this.privateFiles.sweep();
  }

  private refreshViews(): void {
    this.indicator.refresh();
    this.statusDisplay.refresh();
    void this.decoded.refresh();
  }

  /** Tidies every project's confirmations once the engine has reported again. */
  private async pruneConfirmations(): Promise<void> {
    for (const project of this.projects.projects) await this.confirmations.prune(project);
  }

  /** The banner's "Sync to repo…" on a note that was private: asks, then records the answer. */
  private async confirmSyncable(file: TFile, item: ProjectStatusItem): Promise<void> {
    const { project } = item;
    const repoPath =
      project.docsFolder === null
        ? null
        : [project.docsFolder, item.path].filter(Boolean).join("/");
    if (!(await confirmUnprivate(this.app, file.name, repoPath))) return;
    await this.confirmations.confirm(project, item.path, await this.app.vault.read(file));
    new Notice(`${file.name} syncs to the repo on the next sync pass.`);
  }
}
