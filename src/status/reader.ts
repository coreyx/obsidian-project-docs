/**
 * The sync engine's status, as Obsidian shows it (REQ-17.0.3, TASK-10). The engine writes each
 * project's `<vault folder>/.project-docs/status.json` after every pass. Obsidian doesn't watch
 * hidden folders, so the plugin reads the file every few seconds, and acts only when it changed.
 * The file never contains real values, so its messages can be shown as they are.
 */
import { Events, type App } from "obsidian";
import {
  parseStatusFile,
  statusFilePath,
  type StatusFile,
  type StatusItem,
} from "@specdevship/project-docs-core/status";
import { fileStore, projectFolderPath, type MetadataStore } from "../metadata.js";
import type { Project, ProjectIndex } from "../projects.js";

/** How often status.json is read again. */
export const STATUS_POLL_MS = 3_000;

/** A status item, with the project it's from. */
export interface ProjectStatusItem extends StatusItem {
  readonly project: Project;
}

/** The overall state across every project, for the status bar. */
export type Summary =
  | { readonly state: "none" }
  | { readonly state: "waiting" }
  | { readonly state: "idle" }
  | { readonly state: "attention"; readonly items: readonly ProjectStatusItem[] };

/** Reads every project's status.json, and fires `changed` when any of them changes. */
export class StatusReader extends Events {
  /** Per project, the text last read, and what it parsed to. */
  private readonly read = new Map<string, { text: string | null; status: StatusFile | null }>();

  constructor(
    private readonly app: App,
    private readonly projects: ProjectIndex,
    private readonly store: MetadataStore = fileStore,
    private readonly folderPath: (project: Project) => string = (p) => projectFolderPath(app, p),
  ) {
    super();
  }

  /** Reads every project's status again, and fires `changed` if anything differs. */
  async refresh(): Promise<void> {
    let changed = false;
    const current = new Set<string>();
    for (const project of this.projects.projects) {
      current.add(project.id);
      const text = await this.store.read(statusFilePath(this.folderPath(project)));
      if (this.read.has(project.id) && this.read.get(project.id)?.text === text) continue;
      this.read.set(project.id, { text, status: parseStatusFile(text) });
      changed = true;
    }
    for (const id of [...this.read.keys()]) {
      if (!current.has(id)) {
        this.read.delete(id);
        changed = true;
      }
    }
    if (changed) this.trigger("changed");
  }

  /** Every item the engine reports, with its project. */
  items(): ProjectStatusItem[] {
    return this.projects.projects.flatMap((project) =>
      (this.read.get(project.id)?.status?.items ?? []).map((item) => ({ ...item, project })),
    );
  }

  /** The items about one vault file. */
  itemsFor(path: string): ProjectStatusItem[] {
    const place = this.projects.projectFor(path);
    if (!place) return [];
    return this.items().filter(
      (item) => item.project.id === place.project.id && item.path === place.key,
    );
  }

  /**
   * The overall state: no projects, waiting for the engine's first status, up to date, or the
   * items that need attention.
   */
  summary(): Summary {
    if (this.projects.projects.length === 0) return { state: "none" };
    const items = this.items();
    if (items.length > 0) return { state: "attention", items };
    const anyStatus = this.projects.projects.some((p) => this.read.get(p.id)?.status);
    return anyStatus ? { state: "idle" } : { state: "waiting" };
  }
}
