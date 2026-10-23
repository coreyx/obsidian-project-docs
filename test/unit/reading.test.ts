import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App, Component as ObsidianComponent, MarkdownPostProcessorContext } from "obsidian";
// The stand-in `obsidian` module itself, for its test hooks; the code under test gets the same one.
import { Component, MarkdownRenderer } from "../mocks/obsidian.js";
import { ReadingViewDecoder } from "../../src/decode/reading.js";

const mapping = new Map([
  ["myhost", "DESK-FAKE01"],
  ["100.64.0.1", "100.99.12.34"],
]);
const NOTE = "# Hosts\n\nssh myhost\n\nno placeholder here";

/** A post-processor context for one section of a note, or for an element with no source lines. */
function context(
  sourcePath: string,
  section: { text: string; lineStart: number; lineEnd: number } | null,
): MarkdownPostProcessorContext {
  return { sourcePath, getSectionInfo: () => section } as unknown as MarkdownPostProcessorContext;
}

/** A rendered section element on the page, holding the coded text it shows. */
function section(text: string): HTMLElement {
  const el = document.body.createDiv();
  el.createEl("p", { text });
  return el;
}

let decoder: ReadingViewDecoder;

beforeEach(() => {
  MarkdownRenderer.calls = [];
  MarkdownRenderer.onRender = undefined;
  decoder = new ReadingViewDecoder({} as App, new Component() as unknown as ObsidianComponent, 0);
});
afterEach(() => {
  document.body.empty();
});

describe("ReadingViewDecoder.process", () => {
  it("re-renders a section of a decoded note from its decoded source lines", async () => {
    decoder.enable("a.md", mapping);
    const el = section("ssh myhost");
    await decoder.process(el, context("a.md", { text: NOTE, lineStart: 2, lineEnd: 2 }));
    expect(el.textContent).toBe("ssh DESK-FAKE01");
    expect(MarkdownRenderer.calls).toEqual([{ markdown: "ssh DESK-FAKE01", sourcePath: "a.md" }]);
  });

  it("leaves notes that aren't decoded, and sections decoding doesn't change, alone", async () => {
    const coded = section("ssh myhost");
    await decoder.process(coded, context("a.md", { text: NOTE, lineStart: 2, lineEnd: 2 }));
    expect(coded.textContent).toBe("ssh myhost");

    decoder.enable("a.md", mapping);
    const plain = section("no placeholder here");
    await decoder.process(plain, context("a.md", { text: NOTE, lineStart: 4, lineEnd: 4 }));
    expect(MarkdownRenderer.calls).toEqual([]);
  });

  it("doesn't decode its own re-rendering again", async () => {
    decoder.enable("a.md", mapping);
    let nested = 0;
    MarkdownRenderer.onRender = async (container) => {
      // Obsidian post-processes what a renderer call produces, with the same note's path.
      nested++;
      await decoder.process(container.createDiv(), context("a.md", null));
    };
    const el = section("ssh myhost");
    await decoder.process(el, context("a.md", { text: NOTE, lineStart: 2, lineEnd: 2 }));
    expect(nested).toBe(1);
    expect(MarkdownRenderer.calls).toHaveLength(1);
    expect(decoder.check("a.md", el.innerText).sectionsWithoutSource).toBe(0);
  });

  it("counts only sections still on the page that have no source lines", async () => {
    decoder.enable("a.md", mapping);
    await decoder.process(section("embedded"), context("a.md", null));
    // Detached: nested in a section that was already replaced.
    await decoder.process(document.createElement("div"), context("a.md", null));
    expect(decoder.check("a.md", "").sectionsWithoutSource).toBe(1);
  });
});

describe("ReadingViewDecoder.check", () => {
  it("is complete only for a decoded note with no placeholder left and every section decoded", async () => {
    expect(decoder.check("a.md", "DESK-FAKE01").complete).toBe(false);
    decoder.enable("a.md", mapping);
    expect(decoder.check("a.md", "DESK-FAKE01 and notmyhost")).toEqual({
      complete: true,
      remaining: [],
      sectionsWithoutSource: 0,
    });
    expect(decoder.check("a.md", "ssh myhost at 100.64.0.1").remaining).toEqual([
      "myhost",
      "100.64.0.1",
    ]);
    await decoder.process(section("x"), context("a.md", null));
    expect(decoder.check("a.md", "DESK-FAKE01").complete).toBe(false);
  });

  it("forgets a note taken out of decoded mode", () => {
    decoder.enable("a.md", mapping);
    expect(decoder.isActive("a.md")).toBe(true);
    decoder.disable("a.md");
    expect(decoder.isActive("a.md")).toBe(false);
    expect(decoder.check("a.md", "").complete).toBe(false);
  });
});

describe("ReadingViewDecoder.wholeText", () => {
  it("renders the whole decoded note, decoding the notes it embeds", async () => {
    decoder.enable("a.md", mapping);
    MarkdownRenderer.onRender = async (container, sourcePath) => {
      if (sourcePath !== "a.md") return;
      // The note's own text is decoded already; an embed of b.md arrives coded, with and
      // without source lines.
      await decoder.process(container.createDiv(), context("a.md", null));
      const embed = container.createDiv();
      embed.createEl("p", { text: "Embedded: myhost" });
      await decoder.process(
        embed,
        context("b.md", { text: "Embedded: myhost", lineStart: 0, lineEnd: 0 }),
      );
      await decoder.process(container.createDiv(), context("b.md", null));
    };
    const result = await decoder.wholeText("a.md", "ssh myhost");
    expect(result?.text).toContain("ssh DESK-FAKE01");
    expect(result?.text).toContain("Embedded: DESK-FAKE01");
    expect(result?.text).not.toContain("myhost");
    expect(result?.missingSource).toBe(1);
    // The off-screen container is gone afterwards.
    expect(document.body.children).toHaveLength(0);
  });

  it("is null for a note that isn't decoded", async () => {
    expect(await decoder.wholeText("a.md", "ssh myhost")).toBeNull();
  });
});
