/**
 * The reading-view decoding prototype (TASK-3, design decision 14). For each test note it measures
 * what reading view shows in decoded mode: placeholders left on the page, sections without source
 * lines, the real values shown, and whether the page matches the whole decoded note rendered at
 * once, as the fallback view would show it. It records results rather than asserting them, since
 * they decide which view becomes the default; run it with PROTOTYPE=1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import type { MarkdownView } from "obsidian";
import { remainingPlaceholders } from "../../../src/decode/sections.js";
import type ProjectDocsPlugin from "../../../src/main.js";

const MAPPING: [string, string][] = [
  ["myhost", "DESK-FAKE01"],
  ["example.ts.net", "fake-otter-0000.ts.net"],
  ["100.64.0.1", "100.99.12.34"],
  ["100.64.0.10", "100.99.12.40"],
];

const NOTES = [
  "paragraphs",
  "callouts",
  "tables",
  "footnotes",
  "code",
  "embeds",
  "properties",
  "public-only",
  "boundaries",
  "long",
];

interface Measurement {
  note: string;
  complete: boolean;
  remaining: string[];
  sectionsWithoutSource: number;
  realValuesShown: string[];
  matchesWhole: boolean;
  wholeRemaining: string[];
  shown: string;
  whole: string;
  wholeMissingSource: number;
  afterScroll?: { complete: boolean; remaining: string[]; sectionsWithoutSource: number };
}

/** Opens a note in decoded reading view inside Obsidian and measures what it shows. */
async function measure(
  note: string,
): Promise<Omit<Measurement, "realValuesShown" | "matchesWhole" | "wholeRemaining">> {
  const measured: Omit<
    Measurement,
    "note" | "realValuesShown" | "matchesWhole" | "wholeRemaining"
  > = await browser.executeObsidian(
    async ({ app, obsidian }, path: string, entries: [string, string][], scrollToEnd: boolean) => {
      const plugin = (app as unknown as { plugins: { plugins: Record<string, ProjectDocsPlugin> } })
        .plugins.plugins["project-docs"];
      if (!plugin) throw new Error("the plugin isn't loaded");
      const decoder = plugin.readingDecoder;
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof obsidian.TFile)) throw new Error(`${path} isn't in the vault`);
      const settle = () => new Promise((resolve) => window.setTimeout(resolve, 1500));
      decoder.enable(path, new Map(entries));
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: "preview" } });
      const view = leaf.view as MarkdownView;
      view.previewMode.rerender(true);
      await settle();
      const shown = view.previewMode.containerEl.innerText;
      const result = decoder.check(path, shown);
      const wholeResult = await decoder.wholeText(path, await app.vault.read(file));
      const whole = wholeResult?.text ?? "";
      const wholeMissingSource = wholeResult?.missingSource ?? -1;
      let afterScroll;
      if (scrollToEnd) {
        view.previewMode.applyScroll(Number.MAX_SAFE_INTEGER);
        await settle();
        afterScroll = decoder.check(path, view.previewMode.containerEl.innerText);
      }
      leaf.detach();
      decoder.disable(path);
      return {
        complete: result.complete,
        remaining: [...result.remaining],
        sectionsWithoutSource: result.sectionsWithoutSource,
        shown,
        whole,
        wholeMissingSource,
        ...(afterScroll
          ? { afterScroll: { ...afterScroll, remaining: [...afterScroll.remaining] } }
          : {}),
      };
    },
    `prototype/${note}.md`,
    MAPPING,
    note === "long",
  );
  return { note, ...measured };
}

const normalize = (text: string) => text.replace(/\s+/g, "");

describe("decoded-view prototype (TASK-3)", function () {
  this.timeout(10 * 60_000);
  const results: Measurement[] = [];

  before(async function () {
    await browser.reloadObsidian({ vault: "./test/e2e/vault" });
  });

  for (const note of NOTES) {
    it(`measures ${note}.md`, async function () {
      const m = await measure(note);
      results.push({
        ...m,
        realValuesShown: MAPPING.map(([, real]) => real).filter((real) => m.shown.includes(real)),
        // Reading view also shows the inline title; the off-screen rendering lays text out
        // differently, so only the characters are compared.
        matchesWhole: normalize(m.shown.replace(/^[^\n]*\n/, "")) === normalize(m.whole),
        wholeRemaining: remainingPlaceholders(m.whole, new Map(MAPPING)),
      });
      expect(m.shown.length).toBeGreaterThan(0);
    });
  }

  after(async function () {
    const version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
    mkdirSync("test/e2e/out", { recursive: true });
    writeFileSync(
      `test/e2e/out/prototype-${version}.json`,
      `${JSON.stringify(results, null, 2)}\n`,
    );
    for (const r of results) {
      console.log(
        [
          r.note.padEnd(12),
          r.complete ? "complete  " : "INCOMPLETE",
          `remaining=${r.remaining.join("|") || "-"}`,
          `noSource=${r.sectionsWithoutSource}`,
          `matchesWhole=${r.matchesWhole}`,
          `whole: remaining=${r.wholeRemaining.join("|") || "-"} noSource=${r.wholeMissingSource}`,
          r.afterScroll ? `afterScroll=${JSON.stringify(r.afterScroll)}` : "",
        ].join("  "),
      );
    }
  });
});
