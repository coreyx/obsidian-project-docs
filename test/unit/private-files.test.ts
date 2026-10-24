import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parsePrivateFilesList } from "@specdevship/project-docs-core/guards";
import { sha256 } from "@specdevship/project-docs-core/status";
import { PrivateFilesList, parseRecords } from "../../src/privacy/private-files.js";
import type { Project } from "../../src/projects.js";
import type { App } from "obsidian";
import { fileStore, projectFolderPath } from "../../src/metadata.js";
import { FileSystemAdapter } from "../mocks/obsidian.js";
import { MemoryVault, PROJECT, appWith, fixedProjects } from "./helpers.js";

/** The vault's copy of the docs folder: the project folder mirrors the repo. */
const P = `${PROJECT.folder}/docs`;
const PIXELS = new Uint8Array([1, 2, 3]);
let dir: string;
let vault: MemoryVault;
let unreadable: Project[];

const listFile = () => path.join(dir, ".project-docs", "private-files.json");
const listed = async () =>
  JSON.parse(await readFile(listFile(), "utf8")) as { files: { path: string; sha256: string }[] };

function list(projects = [PROJECT]): PrivateFilesList {
  return new PrivateFilesList(
    appWith(vault),
    fixedProjects(projects),
    (project) => unreadable.push(project),
    fileStore,
    () => dir,
  );
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pd-private-files-"));
  vault = new MemoryVault();
  unreadable = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PrivateFilesList (REQ-11.0.3)", () => {
  it("records an attachment created in the private folder, in a list the engine reads", async () => {
    vault.binaries.set(`${P}/private/shot.png`, PIXELS);
    await list().onCreate(vault.file(`${P}/private/shot.png`));
    expect((await listed()).files).toEqual([
      { path: "docs/private/shot.png", sha256: sha256(PIXELS) },
    ]);
    const parsed = parsePrivateFilesList(await readFile(listFile(), "utf8"));
    expect(parsed !== "invalid" && parsed.hashes.has(sha256(PIXELS))).toBe(true);
  });

  it("ignores notes, folders, files outside the private folder, and projects without attachment sync", async () => {
    const files = list();
    vault.binaries.set(`${P}/shot.png`, PIXELS);
    await files.onCreate(vault.file(`${P}/private/plan.md`));
    await files.onCreate({ path: `${P}/private` });
    await files.onCreate(vault.file(`${P}/shot.png`));
    await list([{ ...PROJECT, syncAttachments: false }]).onCreate(vault.file(`${P}/private/x.png`));
    await expect(readFile(listFile(), "utf8")).rejects.toThrow();
  });

  it("follows a recorded file when it's renamed or moved out of the private folder (REQ-11.3)", async () => {
    const files = list();
    vault.binaries.set(`${P}/private/shot.png`, PIXELS);
    await files.onCreate(vault.file(`${P}/private/shot.png`));
    vault.binaries.set(`${P}/img/renamed.png`, PIXELS);
    await files.onRename(vault.file(`${P}/img/renamed.png`), `${P}/private/shot.png`);
    expect((await listed()).files).toEqual([
      { path: "docs/img/renamed.png", sha256: sha256(PIXELS) },
    ]);
  });

  it("records a file moved into the private folder, and one moved in from another project", async () => {
    const other: Project = { ...PROJECT, id: "pd_other", folder: "Other" };
    const files = list([PROJECT, other]);
    vault.binaries.set(`${P}/private/in.png`, PIXELS);
    await files.onRename(vault.file(`${P}/private/in.png`), `${P}/in.png`);
    expect((await listed()).files.map((f) => f.path)).toEqual(["docs/private/in.png"]);

    // A recorded file moved to another project keeps its record there too.
    vault.binaries.set("Other/moved.png", PIXELS);
    await files.onRename(vault.file("Other/moved.png"), `${P}/private/in.png`);
    expect(await files.recorded(other, "moved.png")).toBe(sha256(PIXELS));
  });

  it("updates a recorded file's hash when it changes, and ignores unrecorded ones", async () => {
    const files = list();
    vault.binaries.set(`${P}/private/shot.png`, PIXELS);
    await files.onCreate(vault.file(`${P}/private/shot.png`));
    const edited = new Uint8Array([9, 9]);
    vault.binaries.set(`${P}/private/shot.png`, edited);
    await files.onModify(vault.file(`${P}/private/shot.png`));
    expect(await files.recorded(PROJECT, "docs/private/shot.png")).toBe(sha256(edited));
    await files.onModify(vault.file(`${P}/other.png`));
    await files.onModify(vault.file(`${P}/private/plan.md`));
    expect((await listed()).files).toHaveLength(1);
  });

  it("sweeps unrecorded attachments in the private folder, keeping existing records", async () => {
    await mkdir(path.dirname(listFile()), { recursive: true });
    await writeFile(
      listFile(),
      JSON.stringify({ format: 1, files: [{ path: "docs/private/gone.png", sha256: "aa" }] }),
    );
    vault.binaries.set(`${P}/private/new.png`, PIXELS);
    vault.binaries.set(`${P}/public.png`, PIXELS);
    await list().sweep();
    expect((await listed()).files.map((f) => f.path)).toEqual([
      "docs/private/gone.png",
      "docs/private/new.png",
    ]);
  });

  it("never rewrites a list it can't read, and says so once", async () => {
    await mkdir(path.dirname(listFile()), { recursive: true });
    await writeFile(listFile(), "{ broken");
    const files = list();
    vault.binaries.set(`${P}/private/a.png`, PIXELS);
    vault.binaries.set(`${P}/private/b.png`, PIXELS);
    await files.onCreate(vault.file(`${P}/private/a.png`));
    await files.onCreate(vault.file(`${P}/private/b.png`));
    expect(await readFile(listFile(), "utf8")).toBe("{ broken");
    expect(unreadable.map((p) => p.id)).toEqual([PROJECT.id]);
  });

  it("doesn't rewrite a list when nothing changed", async () => {
    await mkdir(path.dirname(listFile()), { recursive: true });
    const text = '{"format":1,"files":[{"path":"img/x.png","sha256":"aa"}]}';
    await writeFile(listFile(), text);
    const files = list();
    vault.binaries.set(`${P}/elsewhere.png`, PIXELS);
    await files.onRename(vault.file(`${P}/elsewhere.png`), `${P}/before.png`);
    expect(await readFile(listFile(), "utf8")).toBe(text);
  });
});

describe("parseRecords", () => {
  it.each([
    ["unparseable JSON", "{"],
    ["another format", '{"format":2,"files":[]}'],
    ["files that aren't a list", '{"format":1,"files":{}}'],
    ["a record without a hash", '{"format":1,"files":[{"path":"a"}]}'],
    ["a null record", '{"format":1,"files":[null]}'],
  ])("refuses %s", (_name, text) => {
    expect(parseRecords(text)).toBeNull();
  });

  it("treats a missing list as empty", () => {
    expect(parseRecords(null)?.size).toBe(0);
  });
});

describe("fileStore", () => {
  it("writes atomically, creating the folder, and reads back, or null for no file", async () => {
    const file = path.join(dir, "nested", "a.json");
    expect(await fileStore.read(file)).toBeNull();
    await fileStore.write(file, "one");
    await fileStore.write(file, "two");
    expect(await fileStore.read(file)).toBe("two");
  });
});

describe("projectFolderPath", () => {
  it("joins the vault's path on disk with the project folder", () => {
    const app = {
      vault: { adapter: new FileSystemAdapter(path.join("C:", "Vault")) },
    } as unknown as App;
    expect(projectFolderPath(app, PROJECT)).toBe(path.join("C:", "Vault", "Projects", "api"));
  });

  it("refuses a vault that isn't on the local filesystem", () => {
    const app = { vault: { adapter: {} } } as unknown as App;
    expect(() => projectFolderPath(app, PROJECT)).toThrow("local filesystem");
  });
});
