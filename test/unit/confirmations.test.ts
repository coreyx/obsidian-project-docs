import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { markdownHash, parseConfirmations } from "@specdevship/project-docs-core/status";
import { Confirmations } from "../../src/privacy/confirmations.js";
import type { Project } from "../../src/projects.js";
import { fileStore } from "../../src/metadata.js";
import { MemoryVault, PROJECT, appWith } from "./helpers.js";

let dir: string;
let project: Project;
let confirmations: Confirmations;

const vaultFolder = () => path.join(dir, "vault", "Projects", "api");
const file = () => path.join(vaultFolder(), ".project-docs", "confirmations.json");
const write = async (target: string, text: string) => {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pd-confirmations-"));
  project = { ...PROJECT, repoPath: path.join(dir, "repo"), docsFolder: "docs" };
  confirmations = new Confirmations(appWith(new MemoryVault()), fileStore, () => vaultFolder());
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Confirmations.confirm (REQ-10.6)", () => {
  it("records the note's path and the hash the engine computes", async () => {
    await confirmations.confirm(project, "plan.md", "plan\r\n");
    expect(parseConfirmations(await readFile(file(), "utf8"))).toEqual([
      { path: "plan.md", sha256: markdownHash("plan\n") },
    ]);
  });

  it("replaces an earlier entry for the same note, and keeps others", async () => {
    await confirmations.confirm(project, "a.md", "one");
    await confirmations.confirm(project, "b.md", "b");
    await confirmations.confirm(project, "a.md", "two");
    expect(await confirmations.list(project)).toEqual([
      { path: "a.md", sha256: markdownHash("two") },
      { path: "b.md", sha256: markdownHash("b") },
    ]);
  });

  it("replaces a file it can't read, which confirmed nothing", async () => {
    await write(file(), "{ broken");
    await confirmations.confirm(project, "a.md", "a");
    expect(await confirmations.list(project)).toHaveLength(1);
  });
});

describe("Confirmations.prune", () => {
  it("keeps an entry until the repo holds exactly the confirmed content", async () => {
    await write(path.join(vaultFolder(), "plan.md"), "plan\n");
    await confirmations.confirm(project, "plan.md", "plan\n");
    await confirmations.prune(project);
    expect(await confirmations.list(project)).toHaveLength(1);

    // The engine synced it; the repo copy may use other line endings.
    await write(path.join(dir, "repo", "plan.md"), "plan\r\n");
    await confirmations.prune(project);
    expect(await confirmations.list(project)).toEqual([]);
  });

  it("removes entries for notes that are gone or changed since", async () => {
    await write(path.join(vaultFolder(), "edited.md"), "edited later\n");
    await confirmations.confirm(project, "edited.md", "as confirmed\n");
    await confirmations.confirm(project, "deleted.md", "gone\n");
    await confirmations.prune(project);
    expect(await confirmations.list(project)).toEqual([]);
  });

  it("keeps an unchanged note's entry while the repo can't be read", async () => {
    project = { ...project, docsFolder: null };
    await write(path.join(vaultFolder(), "plan.md"), "plan\n");
    await confirmations.confirm(project, "plan.md", "plan\n");
    await confirmations.prune(project);
    expect(await confirmations.list(project)).toHaveLength(1);
  });

  it("writes nothing when there's nothing to prune", async () => {
    await confirmations.prune(project);
    await expect(readFile(file(), "utf8")).rejects.toThrow();
  });

  it("runs updates one at a time, so none is lost", async () => {
    await Promise.all(
      ["a.md", "b.md", "c.md"].map((key) => confirmations.confirm(project, key, key)),
    );
    expect((await confirmations.list(project)).map((e) => e.path)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });
});
