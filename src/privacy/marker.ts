/**
 * The private marker (REQ-10.0.3 to 10.0.5, TASK-5): every Markdown note in a project's private
 * folder carries `project-docs: private`, so it stays private wherever it's moved later. The
 * folder alone already keeps a note out of the repo; the marker is the second guard that travels
 * with the note.
 */
import { TFile, type App } from "obsidian";
import { FrontmatterError, readRule, setRule } from "@specdevship/project-docs-core/rules";
import { inPrivateFolder, type ProjectIndex } from "../projects.js";

/** What marking one note did. */
export type MarkResult = "marked" | "already" | "not-private" | "unreadable-frontmatter";

/** Adds the private marker to notes that arrive in a private folder. It never removes one. */
export class PrivateMarker {
  constructor(
    private readonly app: App,
    private readonly projects: ProjectIndex,
  ) {}

  /** True for a Markdown note in a project's private folder, other than the link note. */
  belongsInPrivate(file: TFile): boolean {
    if (file.extension !== "md") return false;
    const place = this.projects.projectFor(file.path);
    if (!place || file.path === place.project.linkNotePath) return false;
    return inPrivateFolder(place.project, place.key);
  }

  /**
   * Marks a note private if it belongs in a private folder and lacks the marker. Only the
   * `project-docs` property changes; the rest of the note stays byte for byte (REQ-9.2). A note
   * whose frontmatter can't be edited safely is left alone, still protected by its folder.
   */
  async mark(file: TFile): Promise<MarkResult> {
    if (!this.belongsInPrivate(file)) return "not-private";
    let result: MarkResult = "already";
    try {
      await this.app.vault.process(file, (text) => {
        if (readRule(text) === "private") return text;
        result = "marked";
        return setRule(text, "private");
      });
    } catch (error) {
      if (error instanceof FrontmatterError) return "unreadable-frontmatter";
      throw error;
    }
    return result;
  }

  /**
   * Marks every note in every private folder that lacks the marker, such as notes copied in while
   * Obsidian was closed (REQ-10.0.4, 10.3). Returns the notes that couldn't be marked.
   */
  async sweep(): Promise<TFile[]> {
    const failed: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.belongsInPrivate(file)) continue;
      if ((await this.mark(file)) === "unreadable-frontmatter") failed.push(file);
    }
    return failed;
  }

  /** The vault `create` and `rename` handler: marks the note if it now belongs in private. */
  readonly onCreateOrRename = (file: unknown): Promise<MarkResult> =>
    file instanceof TFile ? this.mark(file) : Promise.resolve("not-private");
}
