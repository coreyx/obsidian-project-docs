/**
 * End-to-end tests of the plugin in a real, sandboxed Obsidian (TASK-14), one per acceptance
 * criterion it owns. Each opens a fresh linked project built by `buildFixture`.
 */
import { readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { browser, $, $$, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
  markdownHash,
  parseConfirmations,
  parseIgnoredChoices,
  serializeStatusFile,
} from "@specdevship/project-docs-core/status";
import { FOLDER, MAPPING, buildFixture, type Fixture } from "./fixture.js";

let fixture: Fixture;
/** The project folder of the vault Obsidian has open, on disk. */
let folder: string;

const onDisk = (key: string) => path.join(folder, ...key.split("/"));
const read = (key: string) => readFile(onDisk(key), "utf8").catch(() => null);

/** Waits until `check` is true, polling every 100 ms. */
async function until(
  check: () => Promise<boolean> | boolean,
  timeout = 10_000,
  what = "condition",
) {
  await browser.waitUntil(check, {
    timeout,
    interval: 100,
    timeoutMsg: `timed out waiting for ${what}`,
  });
}

/** Opens a project note in the active tab, in reading view. */
async function open(key: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, p: string) => {
    const file = app.vault.getAbstractFileByPath(p);
    if (!(file instanceof obsidian.TFile)) throw new Error(`${p} isn't in the vault`);
    await app.workspace.getLeaf(false).openFile(file, { state: { mode: "preview" } });
  }, `${FOLDER}/${key}`);
}

/** Right-clicks a note in the file explorer, as a person would. */
async function rightClick(key: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, p: string) => {
    const file = app.vault.getAbstractFileByPath(p);
    if (!(file instanceof obsidian.TFile)) throw new Error(`${p} isn't in the vault`);
    const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
    if (!explorer) throw new Error("no file explorer");
    await app.workspace.revealLeaf(explorer);
    (explorer.view as unknown as { revealInFolder(file: unknown): void }).revealInFolder(file);
  }, `${FOLDER}/${key}`);
  const title = $(`.nav-file-title[data-path="${FOLDER}/${key}"]`);
  await title.waitForDisplayed();
  await title.click({ button: "right" });
}

/**
 * Clicks the element under `selector` whose text is exactly `text`, inside the page. Menu items and
 * dialog buttons react to a click event like any other.
 */
async function clickText(selector: string, text: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (sel: string, label: string) => {
          const match = [...document.querySelectorAll<HTMLElement>(sel)].find(
            (el) => el.textContent?.trim() === label,
          );
          match?.click();
          return match !== undefined;
        },
        selector,
        text,
      ),
    { timeout: 5_000, interval: 100, timeoutMsg: `no ${selector} reading "${text}"` },
  );
}

/** Clicks a menu item by its title. */
function clickMenuItem(text: string): Promise<void> {
  return clickText(".menu .menu-item", text);
}

/** The texts of the status bar's items. */
function statusTexts(): Promise<string[]> {
  return $$(".status-bar-item").map((el) => el.getText());
}

describe("the plugin in a linked project", function () {
  before(async function () {
    fixture = await buildFixture({
      // Copied into the private folder while Obsidian was closed (REQ-10.3).
      "private/arrived.md": "# Arrived\n\nCopied in while Obsidian was closed.\n",
      "plan.md": "---\nproject-docs: private\n---\nThe plan.\n",
    });
    await browser.reloadObsidian({ vault: fixture.vault });
    folder = path.join(obsidianPage.getVaultPath(), FOLDER);
    // The plugin has found the project once the status bar names it.
    await until(
      async () => (await read("private/arrived.md"))?.includes("project-docs: private") === true,
      15_000,
      "the project to be found and swept",
    );
  });

  it("marks a file copied into the private folder while Obsidian was closed (REQ-10.3)", async function () {
    expect(await read("private/arrived.md")).toBe(
      "---\nproject-docs: private\n---\n# Arrived\n\nCopied in while Obsidian was closed.\n",
    );
  });

  it("marks a note created in the private folder within 2 seconds (REQ-10.1)", async function () {
    await browser.executeObsidian(async ({ app }, p: string) => {
      await app.vault.create(p, "New and private.\n");
    }, `${FOLDER}/private/created.md`);
    const started = Date.now();
    await until(
      async () =>
        (await read("private/created.md"))?.startsWith("---\nproject-docs: private\n---\n") ===
        true,
      2_000,
      "the marker",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await read("private/created.md")).toBe(
      "---\nproject-docs: private\n---\nNew and private.\n",
    );
  });

  it("offers every rule from the file menu, two clicks from the note (REQ-9.1)", async function () {
    await writeFile(onDisk("guide.md"), "# Guide\n");
    await until(
      async () =>
        await browser.executeObsidian(
          ({ app }, p: string) => app.vault.getAbstractFileByPath(p) !== null,
          `${FOLDER}/guide.md`,
        ),
      5_000,
      "guide.md",
    );
    await rightClick("guide.md");
    const titles = await $$(".menu .menu-item-title").map((el) => el.getText());
    expect(titles).toEqual(
      expect.arrayContaining([
        "Sync rule: Sync both ways",
        "Sync rule: Repo to vault only",
        "Sync rule: Repo only",
        "Sync rule: Private, vault only",
      ]),
    );
    await clickMenuItem("Sync rule: Repo to vault only");
    await until(
      async () => (await read("guide.md")) === "---\nproject-docs: repo-to-vault\n---\n# Guide\n",
      5_000,
      "the rule",
    );
  });

  it("asks before un-privating a note, and cancelling leaves it private (REQ-9.3)", async function () {
    await rightClick("plan.md");
    await clickMenuItem("Sync rule: Sync both ways");
    const modal = $(".modal");
    await modal.waitForDisplayed();
    expect(await modal.getText()).toContain("plan.md is private");
    expect(await modal.getText()).toContain("docs/plan.md");
    await clickText(".modal button", "Cancel");
    await modal.waitForDisplayed({ reverse: true });
    expect(await read("plan.md")).toBe("---\nproject-docs: private\n---\nThe plan.\n");
  });

  it("records the confirmation, so VS Code doesn't ask again (REQ-10.6)", async function () {
    await rightClick("plan.md");
    await clickMenuItem("Sync rule: Sync both ways");
    await clickText(".modal button", "Sync to repo");
    const expected = "---\nproject-docs: sync\n---\nThe plan.\n";
    await until(async () => (await read("plan.md")) === expected, 5_000, "the new rule");
    await until(
      async () => (await read(".project-docs/confirmations.json")) !== null,
      5_000,
      "confirmations.json",
    );
    expect(parseConfirmations(await read(".project-docs/confirmations.json"))).toEqual([
      { path: "plan.md", sha256: markdownHash(expected) },
    ]);
  });

  it("keeps a private attachment's path or hash on the list wherever it goes (REQ-11.3)", async function () {
    const listed = async () =>
      (
        JSON.parse((await read(".project-docs/private-files.json")) ?? '{"files":[]}') as {
          files: { path: string; sha256: string }[];
        }
      ).files;
    await browser.executeObsidian(async ({ app }, p: string) => {
      await app.vault.createBinary(p, new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer);
    }, `${FOLDER}/private/shot.png`);
    await until(
      async () => (await listed()).some((f) => f.path === "private/shot.png"),
      5_000,
      "the record",
    );
    const hash = (await listed())[0]?.sha256;

    await browser.executeObsidian(
      async ({ app, obsidian }, from: string, to: string, copy: string) => {
        const file = app.vault.getAbstractFileByPath(from);
        if (!(file instanceof obsidian.TFile)) throw new Error("no shot.png");
        // Renaming doesn't create the destination folder.
        await app.vault.createFolder(to.slice(0, to.lastIndexOf("/")));
        await app.fileManager.renameFile(file, to);
        const moved = app.vault.getAbstractFileByPath(to);
        if (moved instanceof obsidian.TFile) await app.vault.copy(moved, copy);
      },
      `${FOLDER}/private/shot.png`,
      `${FOLDER}/images/renamed.png`,
      `${FOLDER}/images/duplicate.png`,
    );
    await until(
      async () => (await listed()).some((f) => f.path === "images/renamed.png"),
      5_000,
      "the moved record",
    );
    const files = await listed();
    // The duplicate isn't listed by path, but its content's hash is, which the engine checks too.
    expect(files.map((f) => f.sha256)).toContain(hash);
    expect(files.some((f) => f.path === "private/shot.png")).toBe(false);
  });

  it("shows a held-back change as a banner on the note (REQ-17.2)", async function () {
    await writeFile(onDisk("held.md"), "Links to a private note.\n");
    await mkdir(onDisk(".project-docs"), { recursive: true });
    await writeFile(
      onDisk(".project-docs/status.json"),
      serializeStatusFile({
        updatedAt: new Date().toISOString(),
        state: "attention",
        items: [
          {
            kind: "held-back",
            path: "held.md",
            message: "held.md isn't synced to the repo until this is fixed",
            reasons: ["links to the private note server-notes"],
          },
        ],
      }),
    );
    await until(
      async () =>
        await browser.executeObsidian(
          ({ app }, p: string) => app.vault.getAbstractFileByPath(p) !== null,
          `${FOLDER}/held.md`,
        ),
      5_000,
      "held.md",
    );
    await open("held.md");
    const banner = $(".workspace-leaf.mod-active .project-docs-banner");
    await banner.waitForDisplayed({ timeout: 8_000 });
    expect(await banner.getText()).toContain(
      "held.md isn't synced to the repo until this is fixed",
    );
    expect(await banner.getText()).toContain("links to the private note server-notes");
    expect(await statusTexts()).toContain("Project Docs: 1 needs attention");
  });

  for (const [button, choice] of [
    ["Keep syncing it", "sync"],
    ["Stop syncing it", "stop"],
  ] as const) {
    it(`records "${button}" for a folder that became ignored, for the engine (AC 3.10)`, async function () {
      const folderName = `ignored-${choice}`;
      await mkdir(onDisk(folderName), { recursive: true });
      await writeFile(onDisk(`${folderName}/a.md`), "A note git now ignores.\n");
      await mkdir(onDisk(".project-docs"), { recursive: true });
      await writeFile(
        onDisk(".project-docs/status.json"),
        serializeStatusFile({
          updatedAt: new Date().toISOString(),
          state: "attention",
          items: [
            {
              kind: "now-ignored",
              path: `${folderName}/`,
              message: `${folderName}/ is ignored by git, so its synced file has stopped syncing.`,
              reasons: [`${folderName}/a.md`],
              fix: "sync-ignored",
            },
          ],
        }),
      );
      await until(
        async () =>
          await browser.executeObsidian(
            ({ app }, p: string) => app.vault.getAbstractFileByPath(p) !== null,
            `${FOLDER}/${folderName}/a.md`,
          ),
        5_000,
        `${folderName}/a.md`,
      );
      await open(`${folderName}/a.md`);
      const banner = $(".workspace-leaf.mod-active .project-docs-banner");
      await banner.waitForDisplayed({ timeout: 8_000 });
      expect(await banner.getText()).toContain(`${folderName}/ is ignored by git`);
      await clickText(".workspace-leaf.mod-active .project-docs-banner button", button);
      await until(
        async () => (await read(".project-docs/ignored-choices.json")) !== null,
        5_000,
        "ignored-choices.json",
      );
      expect(parseIgnoredChoices(await read(".project-docs/ignored-choices.json"))).toContainEqual({
        path: `${folderName}/`,
        choice,
      });
      await rm(onDisk(".project-docs/ignored-choices.json"));
    });
  }

  it("lists the project in its settings tab, whose toggles take effect at once (TASK-16)", async function () {
    // Obsidian's settings window isn't in the public API's types. From 1.13 it can open as a
    // separate window, so the tab is reached through its own element rather than the document.
    interface SettingsWindow {
      open(): void;
      openTabById(id: string): void;
      close(): void;
      activeTab: { id: string; containerEl: HTMLElement } | null;
    }
    await browser.executeObsidian(({ app }) => {
      const setting = (app as unknown as { setting: SettingsWindow }).setting;
      setting.open();
      setting.openTabById("project-docs");
    });
    /** The open tab's text, or null while it isn't open. */
    const tabText = () =>
      browser.executeObsidian(({ app }) => {
        const tab = (app as unknown as { setting: SettingsWindow }).setting.activeTab;
        return tab?.id === "project-docs" ? (tab.containerEl.textContent ?? "") : null;
      });
    await until(
      async () => (await tabText())?.includes("Linked projects") === true,
      5_000,
      "the settings tab",
    );
    const text = (await tabText()) ?? "";
    expect(text).toContain(FOLDER);
    expect(text).toContain("Private folder: private");
    expect(text).toContain("Display");

    /** Clicks the toggle of the setting named `name`, as a person would. */
    const toggle = (name: string) =>
      browser.executeObsidian(({ app }, label: string) => {
        const tab = (app as unknown as { setting: SettingsWindow }).setting.activeTab;
        const row = [...(tab?.containerEl.querySelectorAll(".setting-item") ?? [])].find(
          (el) => el.querySelector(".setting-item-name")?.textContent?.trim() === label,
        );
        const control = row?.querySelector<HTMLElement>(".checkbox-container");
        if (!control) throw new Error(`no toggle named ${label}`);
        control.click();
      }, name);
    expect(await statusTexts()).toContain("Project Docs: 1 needs attention");
    await toggle("Sync status in the status bar");
    await until(
      async () => !(await statusTexts()).includes("Project Docs: 1 needs attention"),
      5_000,
      "the sync status to hide",
    );
    await toggle("Sync status in the status bar");
    await until(
      async () => (await statusTexts()).includes("Project Docs: 1 needs attention"),
      5_000,
      "the sync status to come back",
    );
    await browser.executeObsidian(({ app }) => {
      (app as unknown as { setting: SettingsWindow }).setting.close();
    });
  });

  describe("the decoded view (REQ-14.3, 15.3)", function () {
    const reals = MAPPING.map(([, real]) => real);

    /** Opens a note decoded through its header's eye, and returns what the view shows. */
    async function decode(key: string): Promise<string> {
      await open(key);
      const eye = $('.workspace-leaf.mod-active .view-action[aria-label="Show decoded"]');
      await eye.waitForDisplayed({ timeout: 8_000 });
      await eye.click();
      const view = $(".workspace-leaf.mod-active .project-docs-decoded-view");
      await view.waitForDisplayed({ timeout: 8_000 });
      await browser.pause(500);
      return view.getText();
    }

    it("shows the toggle on a coded note without any menu, and the Coded mode", async function () {
      await open("paragraphs.md");
      const eye = $('.workspace-leaf.mod-active .view-action[aria-label="Show decoded"]');
      await eye.waitForDisplayed({ timeout: 8_000 });
      expect(await statusTexts()).toContain("Coded");
    });

    it("shows real values with the indicator, and changes no file", async function () {
      const before = {
        note: await read("paragraphs.md"),
        mtime: (await stat(onDisk("paragraphs.md"))).mtimeMs,
        repo: await readFile(path.join(fixture.repo, "PRIVATE.md"), "utf8"),
      };
      const shown = await decode("paragraphs.md");
      expect(shown).toContain("Decoded: real values shown");
      expect(shown).toContain("DESK-FAKE01");
      expect(shown).toContain("100.99.12.40");
      expect(shown).not.toMatch(/(?<![\p{L}\p{N}])myhost(?![\p{L}\p{N}])/u);
      expect(await statusTexts()).toContain("Decoded: real values shown");
      expect(await read("paragraphs.md")).toBe(before.note);
      expect((await stat(onDisk("paragraphs.md"))).mtimeMs).toBe(before.mtime);
      expect(await readFile(path.join(fixture.repo, "PRIVATE.md"), "utf8")).toBe(before.repo);
    });

    for (const [key, expectations] of [
      [
        "footnotes.md",
        ["DESK-FAKE01 answers on 100.99.12.34", "Every machine on fake-otter-0000.ts.net"],
      ],
      ["properties.md", ["DESK-FAKE01"]],
      [
        "embeds.md",
        ["DESK-FAKE01 lives on fake-otter-0000.ts.net", "curl https://nas.fake-otter-0000.ts.net"],
      ],
      ["callouts.md", ["About DESK-FAKE01"]],
      ["tables.md", ["100.99.12.34"]],
      ["code.md", ["ssh admin@DESK-FAKE01"]],
    ] as const) {
      it(`decodes ${key} completely`, async function () {
        const shown = await decode(key);
        for (const expected of expectations) expect(shown).toContain(expected);
        expect(shown).not.toContain("couldn't be decoded");
        expect(reals.some((real) => shown.includes(real))).toBe(true);
      });
    }

    it("switches back to the coded note", async function () {
      await decode("tables.md");
      await $('.workspace-leaf.mod-active .view-action[aria-label="Show coded"]').click();
      await until(
        async () =>
          (await browser.executeObsidian(({ app }) =>
            app.workspace.getMostRecentLeaf()?.view.getViewType(),
          )) === "markdown",
        5_000,
        "the note",
      );
    });

    it("shows the standard's error, and nothing decoded, without PRIVATE.md (REQ-14.4)", async function () {
      await rm(path.join(fixture.repo, "PRIVATE.md"));
      try {
        const shown = await decode("paragraphs.md");
        expect(shown).toContain("restore it from wherever you keep it");
        expect(shown).not.toContain("DESK-FAKE01");
      } finally {
        await writeFile(
          path.join(fixture.repo, "PRIVATE.md"),
          (await import("./fixture.js")).PRIVATE_MD,
        );
      }
    });

    it("shows a note as it is while PRIVATE.md's table is empty (REQ-15.4)", async function () {
      const privateMd = path.join(fixture.repo, "PRIVATE.md");
      const original = await readFile(privateMd, "utf8");
      await writeFile(
        privateMd,
        "## Placeholders\n\n| Placeholder in the repo | Real value | What it is |\n| --- | --- | --- |\n",
      );
      try {
        const shown = await decode("paragraphs.md");
        expect(shown).toContain("PRIVATE.md has no placeholders yet");
        expect(shown).toContain("myhost");
      } finally {
        await writeFile(privateMd, original);
      }
    });
  });
});
