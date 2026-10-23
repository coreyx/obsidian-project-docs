import { describe, expect, it } from "vitest";
import {
  EMBED_SLOT_CLASS,
  decodeBody,
  embeddedPart,
  remainingPlaceholders,
  splitFrontmatter,
} from "../../src/decode/source.js";

const mapping = new Map([
  ["myhost", "DESK-FAKE01"],
  ["100.64.0.1", "100.99.12.34"],
  ["100.64.0.10", "100.99.12.40"],
  ["1", "ONE"],
]);
const slot = (index: number) => `<span class="${EMBED_SLOT_CLASS}" data-embed="${index}"></span>`;

describe("splitFrontmatter", () => {
  it("separates the YAML from the body", () => {
    expect(splitFrontmatter("---\nhost: myhost\n---\n# Body\n")).toEqual({
      yaml: "host: myhost\n",
      body: "# Body\n",
    });
    expect(splitFrontmatter("---\r\nhost: myhost\r\n---\r\nBody")).toEqual({
      yaml: "host: myhost\r\n",
      body: "Body",
    });
  });

  it("gives the whole text as body without frontmatter, and an empty body after it alone", () => {
    expect(splitFrontmatter("# Just text\n")).toEqual({ yaml: null, body: "# Just text\n" });
    expect(splitFrontmatter("---\na: 1\n---")).toEqual({ yaml: "a: 1\n", body: "" });
  });
});

describe("decodeBody", () => {
  it("decodes the body as one text, and marks where embedded notes go", () => {
    const { markdown, embeds } = decodeBody(
      "ssh myhost\n\n![[servers]]\n\nThen ![[setup#Install|alias]] and ![[deploy#^steps]].",
      mapping,
    );
    expect(markdown).toBe(`ssh DESK-FAKE01\n\n${slot(0)}\n\nThen ${slot(1)} and ${slot(2)}.`);
    expect(embeds).toEqual([
      { target: "servers", heading: undefined, block: undefined },
      { target: "setup", heading: "Install", block: undefined },
      { target: "deploy", heading: undefined, block: "steps" },
    ]);
  });

  it("never decodes inside the slot markup, even for a placeholder that is a digit", () => {
    const { markdown } = decodeBody("1 ![[a]] 1", mapping);
    expect(markdown).toBe(`ONE ${slot(0)} ONE`);
  });

  it("keeps the boundary rule beside an embed, and drops embeds inside public-only blocks", () => {
    expect(decodeBody("myhost![[a]]100.64.0.10", mapping).markdown).toBe(
      `DESK-FAKE01${slot(0)}100.99.12.40`,
    );
    const { markdown } = decodeBody(
      "a\n<!-- public-only -->\n![[hidden]]\n<!-- /public-only -->\nb",
      mapping,
    );
    expect(markdown).toBe("a\nb");
  });

  it("leaves embeds in code, image embeds and plain links as written", () => {
    const { markdown, embeds } = decodeBody(
      "`![[code]]` ![[shot.png]] [[link]] ![[notes.md]]",
      mapping,
    );
    expect(markdown).toBe(`\`![[code]]\` ![[shot.png]] [[link]] ${slot(0)}`);
    expect(embeds.map((e) => e.target)).toEqual(["notes.md"]);
  });

  it("leaves the text coded with no mapping", () => {
    expect(decodeBody("myhost ![[a]]", null).markdown).toBe(`myhost ${slot(0)}`);
  });
});

describe("embeddedPart", () => {
  const note = [
    "# Title",
    "intro",
    "## Install",
    "step one",
    "### Detail",
    "more",
    "## Use",
    "use it",
    "",
    "First line",
    "second line ^steps",
    "",
    "after",
  ].join("\n");

  it("gives the whole body for a plain embed", () => {
    expect(embeddedPart(note, { target: "x" })).toBe(note);
  });

  it("gives a heading's section, up to the next heading at the same or a higher level", () => {
    expect(embeddedPart(note, { target: "x", heading: "install" })).toBe(
      "## Install\nstep one\n### Detail\nmore",
    );
    expect(embeddedPart(note, { target: "x", heading: "Use" })).toBe(
      ["## Use", "use it", "", "First line", "second line ^steps", "", "after"].join("\n"),
    );
  });

  it("gives a block's paragraph without its id", () => {
    expect(embeddedPart(note, { target: "x", block: "steps" })).toBe("First line\nsecond line");
  });

  it("gives nothing for a heading or block that isn't there", () => {
    expect(embeddedPart(note, { target: "x", heading: "Missing" })).toBe("");
    expect(embeddedPart(note, { target: "x", block: "nope" })).toBe("");
  });
});

describe("remainingPlaceholders", () => {
  it("names placeholders still showing, with the boundary rule", () => {
    const mapping = new Map([
      ["myhost", "DESK-FAKE01"],
      ["100.64.0.1", "100.99.12.34"],
      ["100.64.0.10", "100.99.12.40"],
    ]);
    expect(remainingPlaceholders("ssh myhost at 100.64.0.1", mapping)).toEqual([
      "myhost",
      "100.64.0.1",
    ]);
    expect(remainingPlaceholders("notmyhost and 100.64.0.10", mapping)).toEqual(["100.64.0.10"]);
    expect(remainingPlaceholders("DESK-FAKE01", mapping)).toEqual([]);
  });
});
