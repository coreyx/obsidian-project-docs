import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parseIgnoredChoices, type StatusItem } from "@specdevship/project-docs-core/status";
import { fileStore } from "../../src/metadata.js";
import type { Project } from "../../src/projects.js";
import { IgnoredChoices } from "../../src/status/ignored-choices.js";
import { MemoryVault, PROJECT, appWith } from "./helpers.js";

let dir: string;
let project: Project;
let choices: IgnoredChoices;

const vaultFolder = () => path.join(dir, "vault", "Projects", "api");
const file = () => path.join(vaultFolder(), ".project-docs", "ignored-choices.json");
const recorded = async () => parseIgnoredChoices(await readFile(file(), "utf8").catch(() => null));

/** A `now-ignored` status item for a folder or file. */
const nowIgnored = (p: string): StatusItem => ({
  kind: "now-ignored",
  path: p,
  message: `${p} is ignored by git`,
  reasons: [],
  fix: "sync-ignored",
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pd-ignored-choices-"));
  project = { ...PROJECT };
  choices = new IgnoredChoices(appWith(new MemoryVault()), fileStore, () => vaultFolder());
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("IgnoredChoices.choose (AC 3.10)", () => {
  it("records the notice's path and the choice, replacing an earlier one for the same path", async () => {
    await choices.choose(project, "drafts/", "stop");
    await choices.choose(project, "notes/solo.md", "sync");
    await choices.choose(project, "drafts/", "sync");
    expect(await recorded()).toEqual([
      { path: "drafts/", choice: "sync" },
      { path: "notes/solo.md", choice: "sync" },
    ]);
    expect(await choices.list(project)).toEqual(await recorded());
  });

  it("replaces a file it can't read", async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), "{ not json");
    await choices.choose(project, "drafts/", "stop");
    expect(await recorded()).toEqual([{ path: "drafts/", choice: "stop" }]);
  });
});

describe("IgnoredChoices.prune", () => {
  beforeEach(async () => {
    await choices.choose(project, "drafts/", "sync");
    await choices.choose(project, "old/", "stop");
  });

  it("keeps the choices whose notice is still reported, and removes the others", async () => {
    await choices.prune(project, [
      nowIgnored("drafts/"),
      { ...nowIgnored("old/"), kind: "conflict" },
    ]);
    expect(await recorded()).toEqual([{ path: "drafts/", choice: "sync" }]);
  });

  it("removes nothing while there's no status to go by", async () => {
    await choices.prune(project, null);
    expect(await recorded()).toHaveLength(2);
  });

  it("doesn't write the file when nothing changes", async () => {
    await writeFile(file(), (await readFile(file(), "utf8")) + " ");
    await choices.prune(project, [nowIgnored("drafts/"), nowIgnored("old/")]);
    expect((await readFile(file(), "utf8")).endsWith(" ")).toBe(true);
  });
});
