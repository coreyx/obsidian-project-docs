/**
 * Finding the Project Docs projects in the vault (TASK-4). A project is a vault folder whose folder
 * note, the link note, carries `project-docs-id` and `project-docs-repo` in its frontmatter
 * (design.md, Data model). Each project's settings come from the repo's `.project-docs.json`, read
 * through the path in the link note, since the plugin never copies anything from the repo.
 *
 * The project folder mirrors the repo (design decision 21, TASK-18): a note's key within it is its
 * path in the repo, and only the docs folder and the root files the link lists sync.
 */
import { Events, type App, type CachedMetadata, type TFile } from "obsidian";
import { createScope, privateFolderKey } from "@specdevship/project-docs-core";
import { inPrivateSubfolder } from "@specdevship/project-docs-core/guards";
import { readLink, type LinkState } from "@specdevship/project-docs-core/records";

/** One linked project, as the plugin sees it. */
export interface Project {
  readonly id: string;
  /** The project folder, vault-relative, with `/` separators and no trailing slash. */
  readonly folder: string;
  /** The link note, vault-relative. */
  readonly linkNotePath: string;
  /** The repo, as this machine opens it (a `\\wsl.localhost\...` path for a WSL repo). */
  readonly repoPath: string;
  /** The private subfolder setting, relative to the docs folder. */
  readonly privateSubfolder: string;
  /**
   * The private folder's key within the project folder, or null while the repo can't be read:
   * the private subfolder is inside the docs folder, which only the repo's record names.
   */
  readonly privateFolder: string | null;
  readonly syncAttachments: boolean;
  /** The repo's docs folder, repo-relative (`""` for the repo root), or null when the repo can't be read. */
  readonly docsFolder: string | null;
  /** The Markdown files at the top of the repo that sync beside the docs folder. */
  readonly rootFiles: readonly string[];
  /** False while the repo's link record can't be read; the settings are then the safe defaults. */
  readonly reachable: boolean;
}

/** A note whose frontmatter makes it a link note. */
export interface LinkNote {
  readonly path: string;
  readonly id: string;
  readonly repoPath: string;
}

/** The link-note properties in a note's cached frontmatter, or null if it isn't a link note. */
export function linkNoteOf(path: string, cache: CachedMetadata | null): LinkNote | null {
  const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
  const id = frontmatter?.["project-docs-id"];
  const repoPath = frontmatter?.["project-docs-repo"];
  if (typeof id !== "string" || typeof repoPath !== "string" || !id || !repoPath) return null;
  return { path, id, repoPath };
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * The project a link note stands for, given what reading its repo's records found. The repo's
 * committed record is used only when it's for this project. Otherwise, as while the repo is
 * unreachable, the settings are the ones that can only protect more:
 * - the default private subfolder, though with the docs folder unknown there's no private folder;
 * - attachments tracked, so the private-files list is ready if attachment sync is on.
 * Without the docs folder the plugin can't tell which notes sync, so it treats every note as one
 * that may: its rule can still be changed, and the engine applies it once the repo is back.
 */
export function projectOf(note: LinkNote, link: LinkState | null): Project {
  const committed =
    link &&
    (link.state === "linked" || link.state === "relink") &&
    link.committed.projectId === note.id
      ? link.committed
      : null;
  if (!committed) {
    return {
      id: note.id,
      folder: parentOf(note.path),
      linkNotePath: note.path,
      repoPath: note.repoPath,
      privateSubfolder: "private",
      privateFolder: null,
      syncAttachments: true,
      docsFolder: null,
      rootFiles: [],
      reachable: false,
    };
  }
  const docsFolder = committed.docsFolder.split(/[\\/]/).filter(Boolean).join("/");
  return {
    id: note.id,
    folder: committed.vaultFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    linkNotePath: note.path,
    repoPath: note.repoPath,
    privateSubfolder: committed.settings.privateSubfolder,
    privateFolder: privateFolderKey(docsFolder, committed.settings.privateSubfolder),
    syncAttachments: committed.settings.syncAttachments,
    docsFolder,
    rootFiles: committed.settings.rootFiles,
    reachable: true,
  };
}

/**
 * True when the note at `key` is in what the link syncs: the docs folder, or a root file the link
 * lists (REQ-22). Anything else in the project folder stays in the vault. While the repo can't be
 * read, every key may sync, as `projectOf` explains.
 */
export function syncsKey(project: Project, key: string): boolean {
  return (
    project.docsFolder === null || createScope(project.docsFolder, project.rootFiles).includes(key)
  );
}

/** True when the key is in the project's private folder; never while that folder is unknown. */
export function inPrivateFolder(project: Project, key: string): boolean {
  return project.privateFolder !== null && inPrivateSubfolder(key, project.privateFolder);
}

/** A file's place in a project: the project, and the file's key within the project folder. */
export interface ProjectFile {
  readonly project: Project;
  readonly key: string;
}

/**
 * The project a vault path belongs to, and its key there, or null outside every project. The
 * innermost project folder wins, should one project folder contain another.
 */
export function projectFileOf(projects: readonly Project[], path: string): ProjectFile | null {
  let best: ProjectFile | null = null;
  for (const project of projects) {
    const prefix = project.folder === "" ? "" : `${project.folder}/`;
    if (!path.startsWith(prefix) || path === project.folder) continue;
    if (best && best.project.folder.length >= project.folder.length) continue;
    best = { project, key: path.slice(prefix.length) };
  }
  return best;
}

/** How often the repos' settings are read again, in case `.project-docs.json` changed. */
export const SETTINGS_REFRESH_MS = 60_000;

/** Keeps the vault's projects up to date, and says when they change. */
export class ProjectIndex extends Events {
  private current: readonly Project[] = [];
  private refreshing: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly app: App,
    private readonly read: (repoPath: string) => Promise<LinkState> = readLink,
  ) {
    super();
  }

  /** The projects found by the last refresh. */
  get projects(): readonly Project[] {
    return this.current;
  }

  /** The project a vault path belongs to, and its key there; null outside every project. */
  projectFor(path: string): ProjectFile | null {
    return projectFileOf(this.current, path);
  }

  /** True when the note is a link note, or was one at the last refresh. */
  affects(file: TFile, cache: CachedMetadata | null): boolean {
    return (
      linkNoteOf(file.path, cache) !== null ||
      this.current.some((p) => p.linkNotePath === file.path)
    );
  }

  /**
   * Finds the link notes and reads each repo's settings again. A refresh asked for while one runs
   * is done once more afterwards, so nothing is missed. Fires `changed` when the projects differ.
   */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        await this.scan();
      } while (this.again);
      this.refreshing = null;
    })();
    return this.refreshing;
  }

  private async scan(): Promise<void> {
    const notes = this.app.vault
      .getMarkdownFiles()
      .map((file) => linkNoteOf(file.path, this.app.metadataCache.getFileCache(file)))
      .filter((note): note is LinkNote => note !== null);
    const projects = await Promise.all(
      notes.map(async (note) => projectOf(note, await this.read(note.repoPath).catch(() => null))),
    );
    projects.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
    if (JSON.stringify(projects) === JSON.stringify(this.current)) return;
    this.current = projects;
    this.trigger("changed", projects);
  }
}
