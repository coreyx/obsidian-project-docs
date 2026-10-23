/**
 * Reading a project's PRIVATE.md from its repo (REQ-14.0.6). The plugin reads it through the repo
 * path in the link note and never copies it into the vault.
 */
import { stat } from "node:fs/promises";
import * as path from "node:path";
import {
  PrivateMdError,
  loadPlaceholders,
  type PrivateMdMapping,
} from "@specdevship/project-docs-core/privatemd";

/** A repo's mapping, or the standard's error explaining why it can't be used (REQ-14.0.5). */
export type MappingResult =
  { readonly mapping: PrivateMdMapping } | { readonly error: string; readonly kind: string };

/** Reads and decodes the repo's PRIVATE.md, failing closed as the standard requires. */
export async function loadMapping(repoPath: string): Promise<MappingResult> {
  try {
    return { mapping: await loadPlaceholders(path.join(repoPath, "PRIVATE.md")) };
  } catch (error) {
    if (error instanceof PrivateMdError) return { error: error.message, kind: error.kind };
    throw error;
  }
}

/**
 * True when the repo uses PRIVATE.md: it has the file, or the committed example that shows it
 * once did, in which case decoding shows the "restore it" error rather than nothing (REQ-14.4).
 */
export async function usesPrivateMd(repoPath: string): Promise<boolean> {
  for (const name of ["PRIVATE.md", "PRIVATE.example.md"]) {
    const found = await stat(path.join(repoPath, name)).then(
      (s) => s.isFile(),
      () => false,
    );
    if (found) return true;
  }
  return false;
}

/** When the repo's PRIVATE.md last changed, or null when it's missing, to tell when to redecode. */
export async function privateMdVersion(repoPath: string): Promise<number | null> {
  return stat(path.join(repoPath, "PRIVATE.md")).then(
    (s) => s.mtimeMs,
    () => null,
  );
}
