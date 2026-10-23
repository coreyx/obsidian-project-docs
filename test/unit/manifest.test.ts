import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;

const manifest = read("manifest.json");
const versions = read("versions.json");
const pkg = read("package.json");

describe("the plugin manifest", () => {
  it("meets the community store's rules", () => {
    // The store rejects ids containing "obsidian", and the plugin needs Node's filesystem.
    expect(manifest.id).toBe("project-docs");
    expect(String(manifest.id)).not.toMatch(/obsidian/i);
    expect(manifest.isDesktopOnly).toBe(true);
    expect(String(manifest.description)).not.toMatch(/obsidian/i);
  });

  it("agrees with package.json and versions.json", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(versions[String(manifest.version)]).toBe(manifest.minAppVersion);
  });

  it("pins the core to an exact version, since 0.x releases may change its API", () => {
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps["@specdevship/project-docs-core"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
