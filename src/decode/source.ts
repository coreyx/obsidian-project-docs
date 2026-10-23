/**
 * Preparing a note's source for the decoded view (design decision 14, TASK-11), with no Obsidian
 * dependency so it can be unit-tested: separating the frontmatter, decoding the body as one text
 * under the standard's rules, and marking where embedded notes go, so the view can render each one
 * decoded from its own file.
 */
import { protectedRanges, findWikiLinks } from "@specdevship/project-docs-core/links";
import {
  placeholderPattern,
  restore,
  type PrivateMdMapping,
} from "@specdevship/project-docs-core/privatemd";
import { findFrontmatter } from "@specdevship/project-docs-core/rules";

/** Marks where an embedded note is rendered into the decoded view. */
export const EMBED_SLOT_CLASS = "project-docs-embed-slot";

/** A note embedded in another, as `![[target#heading]]` or `![[target#^block]]` names it. */
export interface Embed {
  readonly target: string;
  readonly heading?: string | undefined;
  readonly block?: string | undefined;
}

/** A note's text split into its frontmatter's YAML (null without any) and its body. */
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const block = findFrontmatter(text);
  if (!block) return { yaml: null, body: text };
  const closingLineEnd = text.indexOf("\n", block.yamlEnd);
  return { yaml: block.yaml, body: closingLineEnd === -1 ? "" : text.slice(closingLineEnd + 1) };
}

/** True for an embed of a note, rather than of an image or other attachment. */
function embedsNote(target: string): boolean {
  const name = target.slice(target.lastIndexOf("/") + 1);
  return !name.includes(".") || name.toLowerCase().endsWith(".md");
}

// Each embed is first replaced by a token of Unicode private-use characters. No placeholder
// contains them, and they're neither letters nor digits, so decoding the note as one text can't
// match inside a token or across one, and its boundary rule sees the same neighbors it would
// have seen beside the embed.
const TOKEN_START = "";
const TOKEN_END = "";
const TOKEN_INDEX_BASE = 0xe100;
const TOKEN = /([-])/g;

/**
 * Decodes a note's body with `mapping` (left coded when null), and replaces each embedded note
 * with an empty slot element that names its index in `embeds`. Embeds inside code stay as written.
 */
export function decodeBody(
  body: string,
  mapping: PrivateMdMapping | null,
): { markdown: string; embeds: Embed[] } {
  const embeds: Embed[] = [];
  let tokenized = "";
  let last = 0;
  for (const link of findWikiLinks(body, protectedRanges(body))) {
    if (!link.embed || !embedsNote(link.target) || embeds.length >= 0x17ff) continue;
    tokenized += body.slice(last, link.start);
    tokenized += TOKEN_START + String.fromCharCode(TOKEN_INDEX_BASE + embeds.length) + TOKEN_END;
    embeds.push({ target: link.target, heading: link.heading, block: link.block });
    last = link.end;
  }
  tokenized += body.slice(last);
  const decoded = mapping ? restore(tokenized, mapping) : tokenized;
  const markdown = decoded.replace(
    TOKEN,
    (_token, index: string) =>
      `<span class="${EMBED_SLOT_CLASS}" data-embed="${index.charCodeAt(0) - TOKEN_INDEX_BASE}"></span>`,
  );
  return { markdown, embeds };
}

/**
 * The part of a note an embed shows: the section under a heading (up to the next heading of the
 * same or a higher level), the paragraph carrying a block id, or the whole note. Empty when the
 * heading or block isn't there, as Obsidian then shows nothing from the note either.
 */
export function embeddedPart(body: string, embed: Embed): string {
  const lines = body.split("\n");
  if (embed.heading !== undefined) {
    const wanted = embed.heading.trim().toLowerCase();
    const start = lines.findIndex((line) => {
      const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      return match?.[2]?.toLowerCase() === wanted;
    });
    if (start === -1) return "";
    const level = /^#+/.exec(lines[start] ?? "")?.[0].length ?? 1;
    let end = start + 1;
    while (end < lines.length) {
      const next = /^(#{1,6})\s/.exec(lines[end] ?? "");
      if (next?.[1] && next[1].length <= level) break;
      end++;
    }
    return lines.slice(start, end).join("\n");
  }
  if (embed.block !== undefined) {
    const marker = new RegExp(`\\s\\^${embed.block.replace(/[^\w-]/g, "")}\\s*$`);
    const at = lines.findIndex((line) => marker.test(line));
    if (at === -1) return "";
    let start = at;
    while (start > 0 && (lines[start - 1] ?? "").trim() !== "") start--;
    return lines
      .slice(start, at + 1)
      .join("\n")
      .replace(marker, "");
  }
  return body;
}

/**
 * The mapped placeholders still visible in rendered text, with the standard's boundary rule, so
 * `notmyhost` doesn't count as `myhost`. Empty means nothing coded is left on screen.
 */
export function remainingPlaceholders(text: string, mapping: PrivateMdMapping): string[] {
  return [...mapping.keys()].filter((placeholder) =>
    new RegExp(placeholderPattern(placeholder), "u").test(text),
  );
}
