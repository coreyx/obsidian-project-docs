/**
 * Confirmations (design decision 17, REQ-10.6, TASK-7). When the user agrees in Obsidian that a
 * private note may sync, the plugin records the note's path and content hash in
 * `<vault folder>/.project-docs/confirmations.json`. The engine releases a held note only while
 * its path and hash match an entry, so the user isn't asked again in VS Code, and a later edit is
 * never covered by an earlier confirmation.
 */
import * as path from "node:path";
import type { App } from "obsidian";
import {
  confirmationsPath,
  markdownHash,
  parseConfirmations,
  serializeConfirmations,
  type Confirmation,
} from "@specdevship/project-docs-core/status";
import { fileStore, projectFolderPath, type MetadataStore } from "../metadata.js";
import type { Project } from "../projects.js";

/** Records and tidies the confirmations of every project. */
export class Confirmations {
  /** Per project, the chain of updates, so one finishes before the next reads the file. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly app: App,
    private readonly store: MetadataStore = fileStore,
    private readonly folderPath: (project: Project) => string = (p) => projectFolderPath(app, p),
  ) {}

  /** The project's current confirmations. */
  async list(project: Project): Promise<readonly Confirmation[]> {
    return parseConfirmations(await this.store.read(this.file(project)));
  }

  /**
   * Records that the note at `key`, with exactly `text`, may sync. It replaces any earlier entry
   * for the same note, which covered content that no longer exists.
   */
  confirm(project: Project, key: string, text: string): Promise<void> {
    return this.update(project, (entries) => [
      ...entries.filter((entry) => entry.path !== key),
      { path: key, sha256: markdownHash(text) },
    ]);
  }

  /**
   * Removes the entries that have done their job or can't any more: the note is gone, it has
   * changed since it was confirmed, or the repo already holds exactly the confirmed content. While
   * the repo can't be read, an entry whose note is unchanged is kept.
   */
  prune(project: Project): Promise<void> {
    return this.update(project, async (entries) => {
      const kept: Confirmation[] = [];
      for (const entry of entries) {
        const note = await this.store.read(
          path.join(this.folderPath(project), ...entry.path.split("/")),
        );
        if (note === null || markdownHash(note) !== entry.sha256) continue;
        if (project.docsFolder !== null) {
          const repoCopy = await this.store.read(
            path.join(project.repoPath, ...project.docsFolder.split("/"), ...entry.path.split("/")),
          );
          if (repoCopy !== null && markdownHash(repoCopy) === entry.sha256) continue;
        }
        kept.push(entry);
      }
      return kept;
    });
  }

  private file(project: Project): string {
    return confirmationsPath(this.folderPath(project));
  }

  /** Applies `change` to the project's entries, and writes the file only if they changed. */
  private update(
    project: Project,
    change: (
      entries: readonly Confirmation[],
    ) => readonly Confirmation[] | Promise<readonly Confirmation[]>,
  ): Promise<void> {
    const run = (this.queues.get(project.id) ?? Promise.resolve()).then(async () => {
      const text = await this.store.read(this.file(project));
      const before = serializeConfirmations(parseConfirmations(text));
      const after = serializeConfirmations(await change(parseConfirmations(text)));
      // An unreadable file confirms nothing, so replacing it loses nothing.
      if (after !== before) await this.store.write(this.file(project), after);
    });
    this.queues.set(
      project.id,
      run.catch(() => undefined),
    );
    return run;
  }
}
