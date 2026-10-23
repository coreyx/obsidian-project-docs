import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { App } from "obsidian";
import { serializeStatusFile, type StatusItem } from "@specdevship/project-docs-core/status";
import type { MetadataStore } from "../../src/metadata.js";
import type { Project } from "../../src/projects.js";
import { StatusDisplay, summaryText } from "../../src/status/banner.js";
import { StatusReader, type ProjectStatusItem } from "../../src/status/reader.js";
import { MarkdownView, TFile } from "../mocks/obsidian.js";
import { PROJECT, fixedProjects } from "./helpers.js";

const P = PROJECT.folder;
const OTHER: Project = {
  ...PROJECT,
  id: "pd_other",
  folder: "Other",
  linkNotePath: "Other/Other.md",
};
const heldBack: StatusItem = {
  kind: "held-back",
  path: "guide.md",
  message: "guide.md isn't synced to the repo until this is fixed",
  reasons: ["links to the private note server-notes"],
};
const wasPrivate: StatusItem = {
  kind: "was-private",
  path: "plan.md",
  message: "plan.md was private, so it isn't synced to the repo until you confirm",
  reasons: [],
  fix: "confirm-syncable",
};

let files: Map<string, string>;
let reads: number;
const store: MetadataStore = {
  read: async (file) => {
    reads++;
    return files.get(file) ?? null;
  },
  write: async () => {},
};
const statusOf = (project: Project) => path.join(project.folder, ".project-docs", "status.json");
const setStatus = (project: Project, items: StatusItem[]) =>
  files.set(
    statusOf(project),
    serializeStatusFile({
      updatedAt: "2026-10-23T00:00:00Z",
      state: items.length ? "attention" : "idle",
      items,
    }),
  );

function reader(projects: Project[] = [PROJECT, OTHER]): StatusReader {
  return new StatusReader({} as App, fixedProjects(projects), store, (p) => p.folder);
}

beforeEach(() => {
  files = new Map();
  reads = 0;
});

describe("StatusReader", () => {
  it("reads each project's status and fires changed only when it differs", async () => {
    const status = reader();
    let changes = 0;
    status.on("changed", () => changes++);
    setStatus(PROJECT, [heldBack]);
    await status.refresh();
    await status.refresh();
    expect(changes).toBe(1);
    expect(status.items().map((i) => [i.project.id, i.path])).toEqual([[PROJECT.id, "guide.md"]]);
    setStatus(OTHER, [wasPrivate]);
    await status.refresh();
    expect(changes).toBe(2);
  });

  it("gives the items about one vault file", async () => {
    const status = reader();
    setStatus(PROJECT, [heldBack, wasPrivate]);
    setStatus(OTHER, [heldBack]);
    await status.refresh();
    expect(status.itemsFor(`${P}/guide.md`).map((i) => i.project.id)).toEqual([PROJECT.id]);
    expect(status.itemsFor("Elsewhere/guide.md")).toEqual([]);
  });

  it("summarizes: no projects, waiting for a first status, up to date, or attention", async () => {
    expect(reader([]).summary()).toEqual({ state: "none" });
    const status = reader([PROJECT]);
    await status.refresh();
    expect(status.summary()).toEqual({ state: "waiting" });
    setStatus(PROJECT, []);
    await status.refresh();
    expect(status.summary()).toEqual({ state: "idle" });
    setStatus(PROJECT, [heldBack]);
    await status.refresh();
    expect(status.summary()).toMatchObject({ state: "attention", items: [{ path: "guide.md" }] });
  });

  it("ignores a status file it can't read, and forgets projects that go away", async () => {
    files.set(statusOf(PROJECT), "{ broken");
    const projects = [PROJECT];
    const status = new StatusReader(
      {} as App,
      {
        get projects() {
          return projects;
        },
        projectFor: () => null,
      } as never,
      store,
      (p) => p.folder,
    );
    await status.refresh();
    expect(status.summary()).toEqual({ state: "waiting" });
    let changes = 0;
    status.on("changed", () => changes++);
    projects.pop();
    await status.refresh();
    expect(changes).toBe(1);
    expect(reads).toBe(1);
  });
});

describe("summaryText", () => {
  const item = (message: string) => ({ message }) as ProjectStatusItem;

  it("hides with no projects, and says what's going on otherwise", () => {
    expect(summaryText({ state: "none" })).toBeNull();
    expect(summaryText({ state: "waiting" })?.text).toBe("Project Docs: not synced yet");
    expect(summaryText({ state: "idle" })?.text).toBe("Project Docs: up to date");
    expect(summaryText({ state: "attention", items: [item("a")] })?.text).toBe(
      "Project Docs: 1 needs attention",
    );
    expect(summaryText({ state: "attention", items: [item("a"), item("b")] })).toEqual({
      text: "Project Docs: 2 need attention",
      tooltip: "a\nb",
    });
  });
});

describe("StatusDisplay (REQ-17.2)", () => {
  let views: MarkdownView[];
  let statusEl: HTMLElement;
  let confirmed: string[];
  let display: StatusDisplay;
  let status: StatusReader;

  beforeEach(async () => {
    views = [];
    confirmed = [];
    status = reader([PROJECT]);
    statusEl = document.body.createDiv();
    const app = {
      workspace: { getLeavesOfType: () => views.map((view) => ({ view })) },
    } as unknown as App;
    display = new StatusDisplay(app, status, statusEl, async (file, item) => {
      confirmed.push(`${file.path}:${item.kind}`);
    });
    setStatus(PROJECT, [heldBack, wasPrivate]);
    await status.refresh();
  });
  afterEach(() => {
    document.body.empty();
  });

  it("shows the summary in the status bar", () => {
    display.refresh();
    expect(statusEl.textContent).toBe("Project Docs: 2 need attention");
    expect(statusEl.getAttribute("aria-label")).toContain("guide.md isn't synced");
  });

  it("puts a banner with the message and reasons on a note that's held back", () => {
    const view = new MarkdownView(new TFile(`${P}/guide.md`));
    const clean = new MarkdownView(new TFile(`${P}/other.md`));
    views = [view, clean];
    display.refresh();
    const banner = view.contentEl.querySelector(".project-docs-banner");
    expect(banner?.textContent).toContain("guide.md isn't synced to the repo until this is fixed");
    expect(banner?.querySelector("li")?.textContent).toBe("links to the private note server-notes");
    expect(banner?.querySelector("button")).toBeNull();
    expect(clean.contentEl.querySelector(".project-docs-banner")).toBeNull();
  });

  it("offers to sync a note that was private, through the confirmation", () => {
    const view = new MarkdownView(new TFile(`${P}/plan.md`));
    views = [view];
    display.refresh();
    const button = view.contentEl.querySelector("button");
    expect(button?.textContent).toBe("Sync to repo…");
    button?.click();
    expect(confirmed).toEqual([`${P}/plan.md:was-private`]);
  });

  it("keeps an unchanged banner, and removes it once the problem is gone or the view closes", async () => {
    const view = new MarkdownView(new TFile(`${P}/guide.md`));
    views = [view];
    display.refresh();
    const first = view.contentEl.querySelector(".project-docs-banner");
    display.refresh();
    expect(view.contentEl.querySelector(".project-docs-banner")).toBe(first);
    setStatus(PROJECT, [wasPrivate]);
    await status.refresh();
    display.refresh();
    expect(view.contentEl.querySelector(".project-docs-banner")).toBeNull();

    view.file = new TFile(`${P}/plan.md`);
    display.refresh();
    views = [];
    display.refresh();
    expect(view.contentEl.querySelector(".project-docs-banner")).toBeNull();
  });

  it("hides the status bar item with no projects, and clears everything on unload", async () => {
    const view = new MarkdownView(new TFile(`${P}/guide.md`));
    views = [view, new MarkdownView(null)];
    display.refresh();
    display.clear();
    expect(view.contentEl.querySelector(".project-docs-banner")).toBeNull();
    expect(statusEl.textContent).toBe("");

    const app = { workspace: { getLeavesOfType: () => [] } } as unknown as App;
    const none = new StatusDisplay(app, reader([]), statusEl, async () => {});
    none.refresh();
    expect(statusEl.classList.contains("project-docs-hidden")).toBe(true);
  });
});
