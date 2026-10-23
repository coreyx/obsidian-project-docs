/**
 * Decoding one rendered section of a note at a time (design decision 14), with no Obsidian
 * dependency so it can be unit-tested. Reading view hands the plugin a note one section at a time,
 * so a section is decoded from its own source lines rather than from the rendered text, which
 * would miss placeholders split across elements and those inside link targets.
 */
import {
  placeholderPattern,
  restore,
  type PrivateMdMapping,
} from "@specdevship/project-docs-core/privatemd";

// The standard's public-only block (§6.1), matched against the whole note: a block can span
// several sections, so whether a line is inside one can't be told from its own section. The start
// of a line is spelled out as the core's decoder does, because JavaScript's `^` with the `m` flag
// also matches after a lone `\r`, which the standard's reference implementation doesn't.
const PUBLIC_ONLY_BLOCK =
  /(?<![^\n])<!-- public-only -->\r?\n[\s\S]*?(?<![^\n])<!-- \/public-only -->(?:\r?\n|$)/g;

/** Lines of `text` (0-based) that fall inside a public-only block, markers included. */
export function publicOnlyLines(text: string): ReadonlySet<number> {
  const lines = new Set<number>();
  for (const match of text.matchAll(PUBLIC_ONLY_BLOCK)) {
    const first = text.slice(0, match.index).split("\n").length - 1;
    const last = first + match[0].replace(/\r?\n$/, "").split("\n").length - 1;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return lines;
}

/**
 * The decoded source of the section spanning `lineStart` to `lineEnd` (0-based, inclusive) of a
 * note's `text`. Lines inside public-only blocks are dropped, and the rest is restored with the
 * standard's rules. Placeholders never contain a line break and sections break only between
 * lines, so restoring a section gives the same text as restoring the whole note would there.
 */
export function decodeSection(
  text: string,
  lineStart: number,
  lineEnd: number,
  mapping: PrivateMdMapping,
): string {
  const hidden = publicOnlyLines(text);
  const kept = text
    .split("\n")
    .slice(lineStart, lineEnd + 1)
    .filter((_line, index) => !hidden.has(lineStart + index));
  return restore(kept.join("\n"), mapping);
}

/**
 * The mapped placeholders still visible in rendered text, with the standard's boundary rule, so
 * `notmyhost` doesn't count as `myhost`. An empty result means nothing coded is left on screen.
 */
export function remainingPlaceholders(text: string, mapping: PrivateMdMapping): string[] {
  return [...mapping.keys()].filter((placeholder) =>
    new RegExp(placeholderPattern(placeholder), "u").test(text),
  );
}
