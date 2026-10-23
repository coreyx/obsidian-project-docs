import { describe, expect, it } from "vitest";
import type { App, CachedMetadata, TFile } from "obsidian";
import type { CommittedLink, LinkState } from "@specdevship/project-docs-core/records";
import {
  ProjectIndex,
  linkNoteOf,
  projectFileOf,
  projectOf,
  type Project,
} from "../../src/projects.js";

const ID = "pd_3f2c9a1e-7b4d-4c1a-9e2f-5a6b7c8d9e0f";

function committed(overrides: Partial<CommittedLink> = {}): CommittedLink {
  return {
    format: 1,
    description: "",
    projectId: ID,
    docsFolder: "docs",
    vaultFolder: "Projects/api",
    settings: {
      privateSubfolder: "secret",
      folderNotePattern: "{folder}/{folderName}.md",
      syncAttachments: false,
      keepLinksAsWritten: false,
      allowLinksOutsideProjectFolder: false,
      advancedUriDeepLinks: false,
      syncIgnored: [],
    },
    ...overrides,
  };
}

const note = { path: "Projects/api/api.md", id: ID, repoPath: "C:\\src\\api" };

describe("linkNoteOf", () => {
  it("reads the link properties from a note's frontmatter", () => {
    const cache = { frontmatter: { "project-docs-id": ID, "project-docs-repo": "/src/api" } };
    expect(linkNoteOf("Projects/api/api.md", cache as CachedMetadata)).toEqual({
      path: "Projects/api/api.md",
      id: ID,
      repoPath: "/src/api",
    });
  });

  it.each([
    ["no cache", null],
    ["no frontmatter", {}],
    ["no repo", { frontmatter: { "project-docs-id": ID } }],
    ["an empty id", { frontmatter: { "project-docs-id": "", "project-docs-repo": "/r" } }],
    ["a non-text repo", { frontmatter: { "project-docs-id": ID, "project-docs-repo": 3 } }],
  ])("ignores a note with %s", (_name, cache) => {
    expect(linkNoteOf("a.md", cache)).toBeNull();
  });
});

describe("projectOf", () => {
  it("takes the folder and settings from the repo's committed record", () => {
    const link: LinkState = { state: "linked", committed: committed(), local: {} as never };
    expect(projectOf(note, link)).toEqual({
      id: ID,
      folder: "Projects/api",
      linkNotePath: "Projects/api/api.md",
      repoPath: "C:\\src\\api",
      privateSubfolder: "secret",
      syncAttachments: false,
      docsFolder: "docs",
      reachable: true,
    });
  });

  it("uses a committed record that has no local one yet (another machine)", () => {
    const link: LinkState = {
      state: "relink",
      committed: committed({ vaultFolder: "\\Work\\api\\" }),
    };
    expect(projectOf(note, link).folder).toBe("Work/api");
  });

  it.each<[string, LinkState | null]>([
    ["an unreadable repo", null],
    ["an unlinked repo", { state: "unlinked" }],
    ["an invalid record", { state: "invalid", file: "x", problems: [] }],
    [
      "another project's record",
      { state: "linked", committed: committed({ projectId: "pd_other" }), local: {} as never },
    ],
  ])("falls back to the protective defaults for %s", (_name, link) => {
    expect(projectOf(note, link)).toMatchObject({
      folder: "Projects/api",
      privateSubfolder: "private",
      syncAttachments: true,
      docsFolder: null,
      reachable: false,
    });
  });

  it("puts a link note at the vault root in the root folder", () => {
    expect(projectOf({ ...note, path: "api.md" }, null).folder).toBe("");
  });
});

describe("projectFileOf", () => {
  const project = (folder: string) => ({ ...projectOf(note, null), folder }) as Project;
  const outer = project("Projects");
  const inner = project("Projects/api");

  it("gives a file's key within its project folder, the innermost one winning", () => {
    expect(projectFileOf([outer, inner], "Projects/api/private/a.md")).toEqual({
      project: inner,
      key: "private/a.md",
    });
    expect(projectFileOf([inner, outer], "Projects/other.md")?.key).toBe("other.md");
  });

  it("is null outside every project, and for the folder itself", () => {
    expect(projectFileOf([inner], "Elsewhere/a.md")).toBeNull();
    expect(projectFileOf([inner], "Projects/api")).toBeNull();
    expect(projectFileOf([inner], "Projects/apix/a.md")).toBeNull();
  });

  it("handles a project at the vault root", () => {
    expect(projectFileOf([project("")], "a.md")?.key).toBe("a.md");
  });
});

describe("ProjectIndex", () => {
  /** A vault with the given notes and frontmatter, and repos that answer with `links`. */
  function index(
    notes: Record<string, Record<string, unknown> | undefined>,
    links: Record<string, LinkState | Error>,
  ) {
    const files = Object.keys(notes).map((path) => ({ path }) as TFile);
    const app = {
      vault: { getMarkdownFiles: () => files },
      metadataCache: {
        getFileCache: (file: TFile) => {
          const frontmatter = notes[file.path];
          return frontmatter ? { frontmatter } : null;
        },
      },
    } as unknown as App;
    const reads: string[] = [];
    const idx = new ProjectIndex(app, async (repo) => {
      reads.push(repo);
      const link = links[repo];
      if (link instanceof Error || !link) throw link ?? new Error("no repo");
      return link;
    });
    return { idx, reads };
  }

  it("finds every project, keeps them sorted, and fires changed only when they differ", async () => {
    const { idx } = index(
      {
        "Projects/web/web.md": { "project-docs-id": "pd_web", "project-docs-repo": "/r/web" },
        "Projects/api/api.md": { "project-docs-id": ID, "project-docs-repo": "/r/api" },
        "Notes/plain.md": { title: "x" },
        "Notes/none.md": undefined,
      },
      {
        "/r/api": { state: "linked", committed: committed(), local: {} as never },
        "/r/web": new Error("drive not connected"),
      },
    );
    let changes = 0;
    idx.on("changed", () => changes++);
    await idx.refresh();
    expect(idx.projects.map((p) => [p.folder, p.reachable])).toEqual([
      ["Projects/api", true],
      ["Projects/web", false],
    ]);
    expect(idx.projectFor("Projects/web/a.md")?.project.id).toBe("pd_web");
    await idx.refresh();
    expect(changes).toBe(1);
  });

  it("runs a refresh asked for during another once more afterwards", async () => {
    const { idx, reads } = index(
      { "p/p.md": { "project-docs-id": ID, "project-docs-repo": "/r" } },
      { "/r": { state: "unlinked" } },
    );
    await Promise.all([idx.refresh(), idx.refresh(), idx.refresh()]);
    expect(reads).toHaveLength(2);
  });

  it("knows which notes can change the projects", async () => {
    const { idx } = index({ "p/p.md": { "project-docs-id": ID, "project-docs-repo": "/r" } }, {});
    await idx.refresh();
    const cache = (frontmatter?: Record<string, unknown>) =>
      (frontmatter ? { frontmatter } : null) as CachedMetadata | null;
    expect(idx.affects({ path: "p/p.md" } as TFile, cache())).toBe(true);
    expect(
      idx.affects(
        { path: "q/q.md" } as TFile,
        cache({ "project-docs-id": "pd_q", "project-docs-repo": "/q" }),
      ),
    ).toBe(true);
    expect(idx.affects({ path: "p/a.md" } as TFile, cache())).toBe(false);
  });
});
