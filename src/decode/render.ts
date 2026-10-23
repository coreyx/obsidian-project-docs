/**
 * Rendering a note decoded, as a whole (design decision 14, TASK-11): its properties as a
 * read-only table, its body decoded under the standard's whole-text rules, and each embedded note
 * rendered decoded from its own file. A completeness check then confirms nothing coded is left.
 */
import { MarkdownRenderer, parseYaml, type App, type Component, type TFile } from "obsidian";
import { restore, type PrivateMdMapping } from "@specdevship/project-docs-core/privatemd";
import {
  EMBED_SLOT_CLASS,
  decodeBody,
  embeddedPart,
  remainingPlaceholders,
  splitFrontmatter,
} from "./source.js";

/** How deep embeds inside embeds are rendered, as Obsidian also stops at some depth. */
export const MAX_EMBED_DEPTH = 4;

/** What rendering needs from its surroundings. */
export interface RenderContext {
  readonly app: App;
  readonly owner: Component;
  /**
   * The mapping to decode a note with: its own project's, or null for a note in no project, which
   * is rendered as it is.
   */
  mappingFor(file: TFile): Promise<PrivateMdMapping | null>;
}

/** The outcome of the completeness check. */
export interface RenderResult {
  readonly complete: boolean;
  /** Placeholders still visible. */
  readonly remaining: readonly string[];
  /** Embedded notes that couldn't be shown, by link. */
  readonly problems: readonly string[];
}

/**
 * Every piece of text under `el`, one per line, for the completeness check. Unlike `innerText`, it
 * includes hidden text, such as a folded callout's body; unlike `textContent`, it never joins two
 * elements' text, which would put a placeholder against a neighbor and hide it from the boundary
 * rule.
 */
export function everyText(el: HTMLElement): string {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.nodeValue ?? "");
  }
  return parts.join("\n");
}

/** A property value as text: lists joined, anything else as JSON. */
function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

/** Renders decoded properties as a read-only table, never into Obsidian's editable panel. */
function renderProperties(el: HTMLElement, yaml: string, mapping: PrivateMdMapping): void {
  let properties: unknown;
  try {
    properties = parseYaml(restore(yaml, mapping));
  } catch {
    properties = null;
  }
  const table = el.createEl("table", { cls: "project-docs-properties" });
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      const row = table.createEl("tr");
      row.createEl("th", { text: key });
      row.createEl("td", { text: propertyText(value) });
    }
  } else {
    // Frontmatter Obsidian can't read either is shown as its decoded text.
    table.createEl("tr").createEl("td", { text: restore(yaml, mapping) });
  }
}

/**
 * Renders a body decoded, then each embedded note into its slot. `stack` holds the notes being
 * rendered, so a note that embeds itself, directly or not, stops instead of looping.
 */
async function renderBody(
  ctx: RenderContext,
  el: HTMLElement,
  sourcePath: string,
  body: string,
  mapping: PrivateMdMapping | null,
  stack: readonly string[],
  problems: string[],
): Promise<void> {
  const { markdown, embeds } = decodeBody(body, mapping);
  await MarkdownRenderer.render(ctx.app, markdown, el, sourcePath, ctx.owner);
  // The slots are collected before any embed renders, so these are this body's own.
  for (const slot of Array.from(el.querySelectorAll<HTMLElement>(`.${EMBED_SLOT_CLASS}`))) {
    const embed = embeds[Number(slot.dataset.embed)];
    if (!embed) continue;
    const container = createDiv({ cls: "project-docs-embed" });
    slot.replaceWith(container);
    const target = ctx.app.metadataCache.getFirstLinkpathDest(embed.target, sourcePath);
    const link = `![[${embed.target}]]`;
    if (!target) {
      container.setText(`${embed.target} isn't in this vault.`);
      problems.push(link);
      continue;
    }
    if (stack.includes(target.path) || stack.length >= MAX_EMBED_DEPTH) {
      container.setText(`${embed.target} isn't shown here: embeds are nested too deeply.`);
      problems.push(link);
      continue;
    }
    const text = await ctx.app.vault.read(target);
    const part = embeddedPart(splitFrontmatter(text).body, embed);
    const targetMapping = await ctx.mappingFor(target);
    await renderBody(
      ctx,
      container,
      target.path,
      part,
      targetMapping,
      [...stack, target.path],
      problems,
    );
  }
}

/**
 * Renders a note decoded into `el`, and checks what it shows: no placeholder may remain
 * (REQ-14.0.5). The caller shows the page only when the result is complete.
 */
export async function renderDecoded(
  ctx: RenderContext,
  el: HTMLElement,
  file: TFile,
  text: string,
  mapping: PrivateMdMapping,
): Promise<RenderResult> {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml !== null && yaml.trim() !== "") renderProperties(el, yaml, mapping);
  const problems: string[] = [];
  await renderBody(
    ctx,
    el.createDiv({ cls: "project-docs-decoded-body" }),
    file.path,
    body,
    mapping,
    [file.path],
    problems,
  );
  const remaining = remainingPlaceholders(everyText(el), mapping);
  return { complete: remaining.length === 0, remaining, problems };
}
