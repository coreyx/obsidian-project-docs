import { beforeEach, describe, expect, it } from "vitest";
import { FrontmatterError } from "@specdevship/project-docs-core/rules";
import { PrivateMarker } from "../../src/privacy/marker.js";
import { MemoryVault, PROJECT, appWith, fixedProjects } from "./helpers.js";

const P = PROJECT.folder;
let vault: MemoryVault;
let marker: PrivateMarker;

beforeEach(() => {
  vault = new MemoryVault();
  marker = new PrivateMarker(appWith(vault), fixedProjects());
});

describe("PrivateMarker.mark (REQ-10.0.3)", () => {
  it("adds the marker to a note in the private folder, changing nothing else", async () => {
    vault.texts.set(`${P}/private/plan.md`, "---\ntitle: Plan\n---\nBody\n");
    expect(await marker.mark(vault.file(`${P}/private/plan.md`))).toBe("marked");
    expect(vault.texts.get(`${P}/private/plan.md`)).toBe(
      "---\ntitle: Plan\nproject-docs: private\n---\nBody\n",
    );
  });

  it("marks a new, empty note, and one nested deeper in the private folder", async () => {
    vault.texts.set(`${P}/private/new.md`, "");
    vault.texts.set(`${P}/private/2026/q4.md`, "Q4\n");
    expect(await marker.mark(vault.file(`${P}/private/new.md`))).toBe("marked");
    expect(await marker.mark(vault.file(`${P}/private/2026/q4.md`))).toBe("marked");
    expect(vault.texts.get(`${P}/private/new.md`)).toBe("---\nproject-docs: private\n---\n");
  });

  it("replaces any other rule, since the folder makes the note private anyway", async () => {
    vault.texts.set(`${P}/private/a.md`, "---\nproject-docs: sync\n---\n");
    await marker.mark(vault.file(`${P}/private/a.md`));
    expect(vault.texts.get(`${P}/private/a.md`)).toBe("---\nproject-docs: private\n---\n");
  });

  it("leaves a note that already has the marker untouched", async () => {
    vault.texts.set(`${P}/private/a.md`, "---\nproject-docs: private\n---\n");
    expect(await marker.mark(vault.file(`${P}/private/a.md`))).toBe("already");
    expect(vault.writes).toEqual([]);
  });

  it.each([
    ["outside the private folder", `${P}/notes.md`],
    ["in a folder that only starts like it", `${P}/privateer/a.md`],
    ["outside every project", "Elsewhere/private/a.md"],
    ["not Markdown", `${P}/private/shot.png`],
    ["the link note", PROJECT.linkNotePath],
  ])("leaves a file %s alone", async (_name, path) => {
    vault.texts.set(path, "x\n");
    expect(await marker.mark(vault.file(path))).toBe("not-private");
    expect(vault.writes).toEqual([]);
  });

  it("follows the project's own private folder name", async () => {
    const custom = { ...PROJECT, privateSubfolder: "secret/notes" };
    marker = new PrivateMarker(appWith(vault), fixedProjects([custom]));
    vault.texts.set(`${P}/secret/notes/a.md`, "a\n");
    vault.texts.set(`${P}/private/b.md`, "b\n");
    expect(await marker.mark(vault.file(`${P}/secret/notes/a.md`))).toBe("marked");
    expect(await marker.mark(vault.file(`${P}/private/b.md`))).toBe("not-private");
  });

  it("reports frontmatter it can't edit safely, and rethrows anything else", async () => {
    vault.texts.set(`${P}/private/a.md`, "x\n");
    vault.failNext = new FrontmatterError("can't edit this frontmatter");
    expect(await marker.mark(vault.file(`${P}/private/a.md`))).toBe("unreadable-frontmatter");
    vault.failNext = new Error("disk full");
    await expect(marker.mark(vault.file(`${P}/private/a.md`))).rejects.toThrow("disk full");
  });
});

describe("PrivateMarker.sweep (REQ-10.0.4, 10.3)", () => {
  it("marks every unmarked note in the private folders and names those it couldn't", async () => {
    vault.texts.set(`${P}/private/a.md`, "a\n");
    vault.texts.set(`${P}/private/b.md`, "---\nproject-docs: private\n---\n");
    vault.texts.set(`${P}/private/bad.md`, "---\nbad: [\n---\n");
    vault.texts.set(`${P}/notes.md`, "n\n");
    const failed = await marker.sweep();
    expect(failed.map((f) => f.path)).toEqual([`${P}/private/bad.md`]);
    expect(vault.writes).toEqual([`${P}/private/a.md`]);
  });
});

describe("PrivateMarker.onCreateOrRename (REQ-10.0.5)", () => {
  it("marks a note created or moved into the private folder, and ignores folders", async () => {
    vault.texts.set(`${P}/private/moved.md`, "m\n");
    expect(await marker.onCreateOrRename(vault.file(`${P}/private/moved.md`))).toBe("marked");
    expect(await marker.onCreateOrRename({ path: `${P}/private` })).toBe("not-private");
  });

  it("never removes the marker from a note moved out of the private folder", async () => {
    vault.texts.set(`${P}/out.md`, "---\nproject-docs: private\n---\n");
    expect(await marker.onCreateOrRename(vault.file(`${P}/out.md`))).toBe("not-private");
    expect(vault.texts.get(`${P}/out.md`)).toBe("---\nproject-docs: private\n---\n");
  });
});
