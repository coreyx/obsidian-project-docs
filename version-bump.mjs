// Run by `pnpm version <new version>`: writes the new version into manifest.json, and records in
// versions.json which Obsidian version it needs, which Obsidian reads to offer older users a
// release that still works for them.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Sets `version` in the manifest and adds it, with the manifest's minAppVersion, to versions.json. */
export async function bump(
  version,
  manifestFile = "manifest.json",
  versionsFile = "versions.json",
) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const versions = JSON.parse(await readFile(versionsFile, "utf8"));
  manifest.version = version;
  versions[version] = manifest.minAppVersion;
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(versionsFile, `${JSON.stringify(versions, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const version = process.env.npm_package_version;
  if (!version) throw new Error("run this through `pnpm version`, which sets npm_package_version");
  await bump(version);
}
