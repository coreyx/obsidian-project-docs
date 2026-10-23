/**
 * Reading and writing the files the plugin shares with the sync engine in a project's hidden
 * `<vault folder>/.project-docs/` (design decision 7). Obsidian's vault API doesn't index hidden
 * folders, so they're reached through the filesystem, at the vault's path on disk.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { FileSystemAdapter, type App } from "obsidian";
import type { Project } from "./projects.js";

/** Reads and writes whole text files by absolute path. */
export interface MetadataStore {
  /** The file's text, or null when it doesn't exist or can't be read. */
  read(file: string): Promise<string | null>;
  /** Replaces the file atomically, so the engine never reads half of it. */
  write(file: string, text: string): Promise<void>;
}

/** A project folder's absolute path on disk, which the core's path helpers take. */
export function projectFolderPath(app: App, project: Project): string {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    // The manifest makes the plugin desktop-only, where the vault is always on disk.
    throw new Error("Project Docs needs a vault on the local filesystem");
  }
  return path.join(adapter.getBasePath(), ...project.folder.split("/").filter(Boolean));
}

/** The filesystem-backed store. */
export const fileStore: MetadataStore = {
  async read(file) {
    try {
      return await readFile(file, "utf8");
    } catch {
      return null;
    }
  },
  async write(file, text) {
    await mkdir(path.dirname(file), { recursive: true });
    // Written beside the target, then renamed over it: a rename is atomic on one filesystem.
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, text, "utf8");
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  },
};
