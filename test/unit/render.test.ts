import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { App, Component as ObsidianComponent, TFile as ObsidianTFile } from "obsidian";
import type { PrivateMdMapping } from "@specdevship/project-docs-core/privatemd";
import { loadMapping, privateMdVersion, usesPrivateMd } from "../../src/decode/private-md.js";
import { MAX_EMBED_DEPTH, renderDecoded, type RenderContext } from "../../src/decode/render.js";
import { Component, MarkdownRenderer, TFile } from "../mocks/obsidian.js";
import { MemoryVault } from "./helpers.js";

const mapping = new Map([
  ["myhost", "DESK-FAKE01"],
  ["example.ts.net", "fake-otter-0000.ts.net"],
]);

let vault: MemoryVault;
let mappings: Record<string, PrivateMdMapping | null>;
let ctx: RenderContext;

beforeEach(() => {
  vault = new MemoryVault();
  mappings = {};
  MarkdownRenderer.calls = [];
  MarkdownRenderer.onRender = undefined;
  const app = {
    vault,
    metadataCache: {
      getFirstLinkpathDest: (link: string) => {
        const target = link.endsWith(".md") ? link : `${link}.md`;
        return vault.texts.has(target) ? (new TFile(target) as unknown as ObsidianTFile) : null;
      },
    },
  } as unknown as App;
  ctx = {
    app,
    owner: new Component() as unknown as ObsidianComponent,
    mappingFor: async (file) => (file.path in mappings ? (mappings[file.path] ?? null) : mapping),
  };
});
afterEach(() => {
  document.body.empty();
});

/** Renders a note decoded, the way the view does. */
async function render(path: string, text: string) {
  vault.texts.set(path, text);
  const el = document.body.createDiv();
  const result = await renderDecoded(ctx, el, vault.file(path), text, mapping);
  return { el, result };
}

describe("renderDecoded", () => {
  it("renders the body decoded as one text, and passes the completeness check", async () => {
    const { el, result } = await render("a.md", "ssh myhost on example.ts.net");
    expect(el.textContent).toBe("ssh DESK-FAKE01 on fake-otter-0000.ts.net");
    expect(result).toEqual({ complete: true, remaining: [], problems: [] });
  });

  it("shows properties decoded in a read-only table, not in the note's body", async () => {
    const { el } = await render(
      "a.md",
      "---\nhost: myhost\ntags: [servers, example.ts.net]\n---\nBody\n",
    );
    const rows = [...el.querySelectorAll("table.project-docs-properties tr")].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ["host", "DESK-FAKE01"],
      ["tags", "servers, fake-otter-0000.ts.net"],
    ]);
    expect(el.querySelector(".project-docs-decoded-body")?.textContent).toBe("Body");
  });

  it("shows frontmatter Obsidian can't read as its decoded text", async () => {
    const { el } = await render("a.md", "---\n- not: a map\n---\nBody");
    expect(el.querySelector("table")?.textContent).toBe("- not: a map\n");
  });

  it("renders embedded notes decoded from their own files, with their own project's mapping", async () => {
    vault.texts.set("servers.md", "---\nx: 1\n---\nservers: myhost");
    vault.texts.set("other.md", "other: myhost");
    mappings["other.md"] = new Map([["myhost", "OTHER-REAL"]]);
    const { el, result } = await render("a.md", "Top\n![[servers]]\n![[other]]");
    expect(el.querySelectorAll(".project-docs-embed")).toHaveLength(2);
    expect(el.textContent).toContain("servers: DESK-FAKE01");
    expect(el.textContent).toContain("other: OTHER-REAL");
    expect(result.complete).toBe(true);
  });

  it("renders only the embedded section, and embeds inside embeds", async () => {
    vault.texts.set(
      "setup.md",
      "# Setup\nintro\n## Install\nssh myhost\n![[deeper]]\n## Use\nlater",
    );
    vault.texts.set("deeper.md", "deep: example.ts.net");
    const { el } = await render("a.md", "![[setup#Install]]");
    expect(el.textContent).toContain("DESK-FAKE01");
    expect(el.textContent).toContain("deep: fake-otter-0000.ts.net");
    expect(el.textContent).not.toContain("later");
  });

  it("fails the check when an embedded note outside every project shows a placeholder", async () => {
    vault.texts.set("outside.md", "outside: myhost");
    mappings["outside.md"] = null;
    const { result } = await render("a.md", "![[outside]]");
    expect(result).toEqual({ complete: false, remaining: ["myhost"], problems: [] });
  });

  it("stops at a note that embeds itself, and at the depth limit, and says so", async () => {
    const { el, result } = await render("loop.md", "loop\n![[loop]]");
    expect(el.textContent).toContain("isn't shown here: embeds are nested too deeply");
    expect(result.problems).toEqual(["![[loop]]"]);

    for (let i = 0; i <= MAX_EMBED_DEPTH; i++)
      vault.texts.set(`n${i}.md`, `level ${i}\n![[n${i + 1}]]`);
    vault.texts.set(`n${MAX_EMBED_DEPTH + 1}.md`, "bottom");
    const deep = await render("start.md", "![[n0]]");
    expect(deep.result.problems).toHaveLength(1);
  });

  it("says when an embedded note isn't in the vault", async () => {
    const { el, result } = await render("a.md", "![[missing]]");
    expect(el.textContent).toContain("missing isn't in this vault.");
    expect(result.problems).toEqual(["![[missing]]"]);
  });

  it("counts hidden text, such as a folded callout's body, in the check", async () => {
    MarkdownRenderer.onRender = async (el) => {
      const hidden = el.createDiv({ text: "myhost" });
      hidden.hidden = true;
    };
    const { result } = await render("a.md", "x");
    expect(result.remaining).toEqual(["myhost"]);
  });

  it("never joins two elements' text, which would hide a placeholder from the boundary rule", async () => {
    // As a callout's title and body, side by side: "Note" + "myhost" isn't "Notemyhost".
    MarkdownRenderer.onRender = async (el) => {
      const callout = el.createDiv();
      callout.createDiv({ text: "Note" });
      callout.createDiv({ text: "myhost" });
    };
    const { el, result } = await render("a.md", "x");
    expect(el.textContent).toContain("Notemyhost");
    expect(result.remaining).toEqual(["myhost"]);
  });
});

describe("reading PRIVATE.md (REQ-14.0.6)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "pd-private-md-"));
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("loads the mapping, or the standard's error", async () => {
    expect(await loadMapping(repo)).toMatchObject({ kind: "missing-file" });
    expect(await usesPrivateMd(repo)).toBe(false);
    expect(await privateMdVersion(repo)).toBeNull();

    await writeFile(path.join(repo, "PRIVATE.example.md"), "x");
    expect(await usesPrivateMd(repo)).toBe(true);

    await writeFile(path.join(repo, "PRIVATE.md"), "## Placeholders\n\n| `myhost` | `REAL` | |\n");
    const loaded = await loadMapping(repo);
    expect("mapping" in loaded && [...loaded.mapping]).toEqual([["myhost", "REAL"]]);
    expect(typeof (await privateMdVersion(repo))).toBe("number");

    await writeFile(path.join(repo, "PRIVATE.md"), "## Placeholders\n\n| P | R |\n| --- | --- |\n");
    const empty = await loadMapping(repo);
    expect("mapping" in empty && empty.mapping.size).toBe(0);
  });
});
