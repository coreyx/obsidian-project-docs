/**
 * Choices for notes that became ignored by git (main spec REQ-3.0.8, AC 3.10, design decision 20,
 * TASK-17). The banner's **Keep syncing it** and **Stop syncing it** record the choice for the
 * notice's folder or file in `<vault folder>/.project-docs/ignored-choices.json`. The engine carries
 * it out on its next pass, exactly as VS Code's actions do: the plugin writes only in the vault, and
 * neither the repo's `.project-docs.json` nor the engine's state is its to change.
 */
import type { App } from "obsidian";
import {
  ignoredChoicesPath,
  parseIgnoredChoices,
  serializeIgnoredChoices,
  type IgnoredChoice,
  type StatusItem,
} from "@specdevship/project-docs-core/status";
import { fileStore, projectFolderPath, type MetadataStore } from "../metadata.js";
import type { Project } from "../projects.js";

/** Records and tidies the choices of every project. */
export class IgnoredChoices {
  /** Per project, the chain of updates, so one finishes before the next reads the file. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly app: App,
    private readonly store: MetadataStore = fileStore,
    private readonly folderPath: (project: Project) => string = (p) => projectFolderPath(app, p),
  ) {}

  /** The project's current choices. */
  async list(project: Project): Promise<readonly IgnoredChoice[]> {
    return parseIgnoredChoices(await this.store.read(this.file(project)));
  }

  /** Records the choice for a `now-ignored` notice's path, replacing an earlier one for it. */
  choose(project: Project, noticePath: string, choice: IgnoredChoice["choice"]): Promise<void> {
    return this.update(project, (entries) => [
      ...entries.filter((entry) => entry.path !== noticePath),
      { path: noticePath, choice },
    ]);
  }

  /**
   * Removes the choices whose notice has left the project's status. Only the engine writes the
   * status, and it carries out the choices before each pass, so a status without the notice comes
   * from a pass that has seen the choice. With no status to go by (`items` is null), nothing is
   * removed, so a choice made while the engine isn't running waits for it.
   */
  prune(project: Project, items: readonly StatusItem[] | null): Promise<void> {
    if (items === null) return Promise.resolve();
    const reported = new Set(items.filter((i) => i.kind === "now-ignored").map((i) => i.path));
    return this.update(project, (entries) => entries.filter((entry) => reported.has(entry.path)));
  }

  private file(project: Project): string {
    return ignoredChoicesPath(this.folderPath(project));
  }

  /** Applies `change` to the project's entries, and writes the file only if they changed. */
  private update(
    project: Project,
    change: (entries: readonly IgnoredChoice[]) => readonly IgnoredChoice[],
  ): Promise<void> {
    const run = (this.queues.get(project.id) ?? Promise.resolve()).then(async () => {
      const text = await this.store.read(this.file(project));
      const before = serializeIgnoredChoices(parseIgnoredChoices(text));
      const after = serializeIgnoredChoices(change(parseIgnoredChoices(text)));
      // An unreadable file chooses nothing, so replacing it loses nothing.
      if (after !== before) await this.store.write(this.file(project), after);
    });
    this.queues.set(
      project.id,
      run.catch(() => undefined),
    );
    return run;
  }
}
