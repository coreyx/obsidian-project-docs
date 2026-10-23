/**
 * Shared fakes for unit tests: a vault held in memory, and a project index with fixed projects.
 */
import type { App, TFile as ObsidianTFile } from "obsidian";
import { projectFileOf, type Project, type ProjectIndex } from "../../src/projects.js";
import { TFile } from "../mocks/obsidian.js";

export const PROJECT: Project = {
  id: "pd_3f2c9a1e-7b4d-4c1a-9e2f-5a6b7c8d9e0f",
  folder: "Projects/api",
  linkNotePath: "Projects/api/api.md",
  repoPath: "/src/api",
  privateSubfolder: "private",
  syncAttachments: true,
  docsFolder: "docs",
  reachable: true,
};

/** A project index that always knows the given projects. */
export function fixedProjects(projects: readonly Project[] = [PROJECT]): ProjectIndex {
  return {
    projects,
    projectFor: (path: string) => projectFileOf(projects, path),
  } as unknown as ProjectIndex;
}

/** A vault in memory: text files by path, binary files by path, and the writes made to them. */
export class MemoryVault {
  readonly texts = new Map<string, string>();
  readonly binaries = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  /** Makes the next `process` call throw this error, as a failing write would. */
  failNext: Error | undefined;

  file(path: string): ObsidianTFile {
    return new TFile(path) as unknown as ObsidianTFile;
  }

  getMarkdownFiles(): ObsidianTFile[] {
    return [...this.texts.keys()].filter((p) => p.endsWith(".md")).map((p) => this.file(p));
  }

  getFiles(): ObsidianTFile[] {
    return [...this.texts.keys(), ...this.binaries.keys()].map((p) => this.file(p));
  }

  getAbstractFileByPath(path: string): ObsidianTFile | null {
    return this.texts.has(path) || this.binaries.has(path) ? this.file(path) : null;
  }

  async read(file: ObsidianTFile): Promise<string> {
    return this.texts.get(file.path) ?? "";
  }

  async readBinary(file: ObsidianTFile): Promise<ArrayBuffer> {
    const bytes =
      this.binaries.get(file.path) ?? new TextEncoder().encode(this.texts.get(file.path));
    return bytes.slice().buffer;
  }

  async process(file: ObsidianTFile, fn: (text: string) => string): Promise<string> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const before = this.texts.get(file.path) ?? "";
    const after = fn(before);
    if (after !== before) {
      this.texts.set(file.path, after);
      this.writes.push(file.path);
    }
    return after;
  }

  async modify(file: ObsidianTFile, text: string): Promise<void> {
    this.texts.set(file.path, text);
    this.writes.push(file.path);
  }
}

/** An app whose vault is `vault`; other parts are added by each test as needed. */
export function appWith(vault: MemoryVault, extra: Record<string, unknown> = {}): App {
  return { vault, ...extra } as unknown as App;
}
