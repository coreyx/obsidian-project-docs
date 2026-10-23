import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
// @ts-expect-error -- a plain JavaScript build script, with no type declarations.
import { bump } from "../../version-bump.mjs";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pd-version-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("version-bump", () => {
  it("sets the manifest's version and records its minimum Obsidian version", async () => {
    const manifest = path.join(dir, "manifest.json");
    const versions = path.join(dir, "versions.json");
    await writeFile(
      manifest,
      JSON.stringify({ id: "project-docs", version: "0.1.0", minAppVersion: "1.8.7" }),
    );
    await writeFile(versions, JSON.stringify({ "0.1.0": "1.8.7" }));
    await (bump as (v: string, m: string, s: string) => Promise<void>)("0.2.0", manifest, versions);
    expect(JSON.parse(await readFile(manifest, "utf8"))).toEqual({
      id: "project-docs",
      version: "0.2.0",
      minAppVersion: "1.8.7",
    });
    expect(JSON.parse(await readFile(versions, "utf8"))).toEqual({
      "0.1.0": "1.8.7",
      "0.2.0": "1.8.7",
    });
  });
});
