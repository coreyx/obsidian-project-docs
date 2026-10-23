/**
 * A linked project for end-to-end tests, built before Obsidian starts: a repo with the committed
 * link record and PRIVATE.md, and a copy of the test vault whose `decoded` folder is the project,
 * with its link note pointing at that repo. Only fake values are used.
 */
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

export const PROJECT_ID = "pd_3f2c9a1e-7b4d-4c1a-9e2f-5a6b7c8d9e0f";
export const FOLDER = "decoded";

/** The fake mapping: placeholder to real value. */
export const MAPPING: readonly (readonly [string, string])[] = [
  ["myhost", "DESK-FAKE01"],
  ["example.ts.net", "fake-otter-0000.ts.net"],
  ["100.64.0.1", "100.99.12.34"],
  ["100.64.0.10", "100.99.12.40"],
];

export const PRIVATE_MD = [
  "## Placeholders",
  "",
  "| Placeholder in the repo | Real value | What it is |",
  "| --- | --- | --- |",
  ...MAPPING.map(([placeholder, real]) => `| \`${placeholder}\` | \`${real}\` | fake |`),
  "",
].join("\n");

export interface Fixture {
  readonly repo: string;
  readonly vault: string;
}

/**
 * Builds the repo and the vault. `beforeStart` files are written into the vault's project folder
 * before Obsidian opens it, as if copied in while Obsidian was closed.
 */
export async function buildFixture(beforeStart: Record<string, string> = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "pd-e2e-"));
  const repo = path.join(root, "repo");
  const vault = path.join(root, "vault");
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await writeFile(
    path.join(repo, ".project-docs.json"),
    `${JSON.stringify(
      {
        format: 1,
        description: "Project Docs link, for end-to-end tests.",
        projectId: PROJECT_ID,
        docsFolder: "docs",
        vaultFolder: FOLDER,
        settings: {
          privateSubfolder: "private",
          folderNotePattern: "{folder}/{folderName}.md",
          syncAttachments: true,
          keepLinksAsWritten: false,
          allowLinksOutsideProjectFolder: false,
          advancedUriDeepLinks: false,
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(repo, "PRIVATE.md"), PRIVATE_MD);
  await cp(path.resolve("test/e2e/vault"), vault, { recursive: true });
  await writeFile(
    path.join(vault, FOLDER, `${FOLDER}.md`),
    `---\nproject-docs-id: ${PROJECT_ID}\nproject-docs-repo: ${JSON.stringify(repo)}\n---\n`,
  );
  for (const [key, text] of Object.entries(beforeStart)) {
    const file = path.join(vault, FOLDER, ...key.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return { repo, vault };
}
