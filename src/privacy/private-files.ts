/**
 * The private-files list (REQ-11.0.3, TASK-6). Attachments can't carry a private marker, so where
 * attachment sync is on, the plugin records each one that arrives in the private folder, by path
 * and content hash, in `<vault folder>/.project-docs/private-files.json`. The engine never copies
 * a file to the repo whose path or hash is listed (REQ-11.0.4), wherever it's moved or copied.
 */
import { TFile, type App } from "obsidian";
import { inPrivateSubfolder } from "@specdevship/project-docs-core/guards";
import {
  PRIVATE_FILES_FORMAT,
  privateFilesPath,
  serializePrivateFilesList,
  sha256,
} from "@specdevship/project-docs-core/status";
import { fileStore, projectFolderPath, type MetadataStore } from "../metadata.js";
import type { Project, ProjectIndex } from "../projects.js";

/** One project's list as the plugin keeps it: key to hash, or why it can't be kept. */
type ListState = { readonly records: Map<string, string>; saved: string } | "unreadable";

/**
 * Parses an existing list into key-to-hash records. Null for a list that exists but can't be read:
 * rewriting it from scratch would drop the files it protects, so it's left for the user to fix.
 */
export function parseRecords(text: string | null): Map<string, string> | null {
  if (text === null) return new Map();
  try {
    const value = JSON.parse(text) as { format?: unknown; files?: unknown };
    if (value.format !== PRIVATE_FILES_FORMAT || !Array.isArray(value.files)) return null;
    const records = new Map<string, string>();
    for (const record of value.files as unknown[]) {
      const { path, sha256: hash } = (record ?? {}) as { path?: unknown; sha256?: unknown };
      if (typeof path !== "string" || typeof hash !== "string") return null;
      records.set(path, hash);
    }
    return records;
  } catch {
    return null;
  }
}

const serialize = (records: Map<string, string>) =>
  serializePrivateFilesList([...records].map(([path, hash]) => ({ path, sha256: hash })));

/** Keeps every project's private-files list, where attachment sync is on. */
export class PrivateFilesList {
  private readonly lists = new Map<string, ListState>();
  /** Per project, the chain of updates, so one finishes before the next reads the list. */
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * @param onUnreadable Told, once per project, that its list exists but can't be read, so the
   * plugin can say so; the engine meanwhile holds every attachment back.
   */
  constructor(
    private readonly app: App,
    private readonly projects: ProjectIndex,
    private readonly onUnreadable: (project: Project) => void = () => {},
    private readonly store: MetadataStore = fileStore,
    private readonly folderPath: (project: Project) => string = (p) => projectFolderPath(app, p),
  ) {}

  /** The recorded hash of a key in a project, for tests and the status of a file. */
  async recorded(project: Project, key: string): Promise<string | undefined> {
    const list = await this.list(project);
    return list === "unreadable" ? undefined : list.records.get(key);
  }

  /** A vault `create` handler: records an attachment that arrives in a private folder. */
  readonly onCreate = (file: unknown): Promise<void> =>
    file instanceof TFile ? this.recordIfPrivate(file) : Promise.resolve();

  /**
   * A vault `rename` handler. A recorded file is followed to its new path, inside the private
   * folder or out of it; an unrecorded one moved into a private folder is recorded.
   */
  readonly onRename = async (file: unknown, oldPath: string): Promise<void> => {
    if (!(file instanceof TFile) || file.extension === "md") return;
    const from = this.projects.projectFor(oldPath);
    const to = this.projects.projectFor(file.path);
    if (from?.project.syncAttachments) {
      const moved = await this.update(from.project, (records) => {
        const hash = records.get(from.key);
        if (hash === undefined) return null;
        records.delete(from.key);
        if (to?.project.id === from.project.id) records.set(to.key, hash);
        return hash;
      });
      if (moved !== null && moved !== undefined) {
        if (to && to.project.id !== from.project.id) await this.record(to.project, to.key, moved);
        return;
      }
    }
    await this.recordIfPrivate(file);
  };

  /** A vault `modify` handler: a recorded file's hash follows its new content. */
  readonly onModify = async (file: unknown): Promise<void> => {
    if (!(file instanceof TFile) || file.extension === "md") return;
    const place = this.projects.projectFor(file.path);
    if (!place?.project.syncAttachments) return;
    const hash = sha256(new Uint8Array(await this.app.vault.readBinary(file)));
    await this.update(place.project, (records) => {
      if (!records.has(place.key)) return null;
      records.set(place.key, hash);
      return hash;
    });
  };

  /** Records every attachment in a private folder that isn't on its list yet (REQ-11.0.3). */
  async sweep(): Promise<void> {
    for (const file of this.app.vault.getFiles()) await this.recordIfPrivate(file);
  }

  private async recordIfPrivate(file: TFile): Promise<void> {
    if (file.extension === "md") return;
    const place = this.projects.projectFor(file.path);
    if (!place?.project.syncAttachments) return;
    if (!inPrivateSubfolder(place.key, place.project.privateSubfolder)) return;
    if ((await this.recorded(place.project, place.key)) !== undefined) return;
    const hash = sha256(new Uint8Array(await this.app.vault.readBinary(file)));
    await this.record(place.project, place.key, hash);
  }

  private record(project: Project, key: string, hash: string): Promise<unknown> {
    return this.update(project, (records) => {
      records.set(key, hash);
      return hash;
    });
  }

  /**
   * Applies `change` to a project's records and saves the list if it changed. Deleted files are
   * never removed from the list: a copy made before the deletion is still protected by its hash.
   */
  private update<T>(
    project: Project,
    change: (records: Map<string, string>) => T,
  ): Promise<T | undefined> {
    const run = (this.queues.get(project.id) ?? Promise.resolve()).then(async () => {
      const list = await this.list(project);
      if (list === "unreadable") return undefined;
      const result = change(list.records);
      const text = serialize(list.records);
      if (text !== list.saved) {
        await this.store.write(privateFilesPath(this.folderPath(project)), text);
        list.saved = text;
      }
      return result;
    });
    this.queues.set(
      project.id,
      run.catch(() => undefined),
    );
    return run;
  }

  private async list(project: Project): Promise<ListState> {
    const known = this.lists.get(project.id);
    if (known) return known;
    const text = await this.store.read(privateFilesPath(this.folderPath(project)));
    const records = parseRecords(text);
    // `saved` is kept in the form the plugin writes, so an untouched list is never rewritten.
    const state: ListState = records ? { records, saved: serialize(records) } : "unreadable";
    this.lists.set(project.id, state);
    if (state === "unreadable") this.onUnreadable(project);
    return state;
  }
}
