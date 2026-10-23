/**
 * Decoding in Obsidian's reading view (design decision 14), the prototype that TASK-3 measures.
 *
 * While a note is in decoded mode, a Markdown post-processor takes each rendered section's source
 * lines, decodes them with the core, and renders that section again from the decoded source. The
 * completeness check then looks at everything the view shows: no mapped placeholder may remain,
 * and every section must have had source lines to decode. Callers that get a failed check must
 * show the fallback view instead, never the partly decoded page.
 */
import {
  MarkdownRenderer,
  type App,
  type Component,
  type MarkdownPostProcessorContext,
  type MarkdownSectionInformation,
} from "obsidian";
import { restore, type PrivateMdMapping } from "@specdevship/project-docs-core/privatemd";
import { decodeSection, remainingPlaceholders } from "./sections.js";

/** Marks the container a decoded section is rendered into, so its own rendering isn't decoded again. */
const DECODED_SECTION_CLASS = "project-docs-decoded-section";
/** Marks a whole decoded note rendered by the plugin, as the fallback view renders it. */
const DECODED_WHOLE_CLASS = "project-docs-decoded-whole";

/** The outcome of the completeness check for a note in decoded mode. */
export interface CompletenessResult {
  readonly complete: boolean;
  /** Placeholders still visible on the page. */
  readonly remaining: readonly string[];
  /** Sections rendered without source lines, which therefore couldn't be decoded. */
  readonly sectionsWithoutSource: number;
}

/** Decodes the sections of notes in decoded mode as reading view renders them. */
export class ReadingViewDecoder {
  /** Notes in decoded mode, by path, with the mapping they're decoded with. */
  private readonly active = new Map<string, PrivateMdMapping>();
  /** Per note, how many sections rendered without source lines since decoding was turned on. */
  private readonly missingSource = new Map<string, number>();
  /** Whole-note renderings in progress, by their container. */
  private readonly wholeRenderings = new WeakMap<
    HTMLElement,
    { path: string; mapping: PrivateMdMapping; missingSource: number }
  >();

  /**
   * @param settleMs How long a whole-note rendering is given for embeds to finish rendering before
   * its text is read.
   */
  constructor(
    private readonly app: App,
    private readonly owner: Component,
    private readonly settleMs = 1000,
  ) {}

  /** Puts a note in decoded mode. The caller re-renders the view. */
  enable(path: string, mapping: PrivateMdMapping): void {
    this.active.set(path, mapping);
    this.missingSource.set(path, 0);
  }

  /** Takes a note out of decoded mode. The caller re-renders the view. */
  disable(path: string): void {
    this.active.delete(path);
    this.missingSource.delete(path);
  }

  isActive(path: string): boolean {
    return this.active.has(path);
  }

  /** The post-processor to register with `registerMarkdownPostProcessor`. */
  readonly process = async (el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> => {
    if (el.closest(`.${DECODED_SECTION_CLASS}`)) return;
    const whole = el.closest<HTMLElement>(`.${DECODED_WHOLE_CLASS}`);
    if (whole) {
      await this.processEmbedded(el, ctx, whole);
      return;
    }
    const mapping = this.active.get(ctx.sourcePath);
    if (!mapping) return;
    const info = ctx.getSectionInfo(el);
    if (!info) {
      // Elements nested in a section that was already replaced arrive detached; only a section
      // still on the page without source lines is one that couldn't be decoded.
      if (el.isConnected) this.countMissing(ctx.sourcePath);
      return;
    }
    await this.renderDecoded(el, info, mapping, ctx.sourcePath);
  };

  private countMissing(path: string): void {
    this.missingSource.set(path, (this.missingSource.get(path) ?? 0) + 1);
  }

  /** Re-renders a section from its decoded source lines, when decoding changes anything. */
  private async renderDecoded(
    el: HTMLElement,
    info: MarkdownSectionInformation,
    mapping: PrivateMdMapping,
    sourcePath: string,
  ): Promise<void> {
    const decoded = decodeSection(info.text, info.lineStart, info.lineEnd, mapping);
    const source = info.text
      .split("\n")
      .slice(info.lineStart, info.lineEnd + 1)
      .join("\n");
    if (decoded === source) return;
    el.empty();
    const container = el.createDiv({ cls: DECODED_SECTION_CLASS });
    await MarkdownRenderer.render(this.app, decoded, container, sourcePath, this.owner);
  }

  /**
   * Inside a whole-note rendering, the note's own text is decoded already, but notes it embeds are
   * rendered from their coded files: those sections are decoded with the same mapping.
   */
  private async processEmbedded(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    whole: HTMLElement,
  ): Promise<void> {
    const rendering = this.wholeRenderings.get(whole);
    if (!rendering || ctx.sourcePath === rendering.path) return;
    const info = ctx.getSectionInfo(el);
    if (!info) {
      rendering.missingSource++;
      return;
    }
    await this.renderDecoded(el, info, rendering.mapping, ctx.sourcePath);
  }

  /**
   * What `path` shows when its whole source is decoded and rendered at once, as the fallback view
   * does, with the notes it embeds decoded too. Null when the note isn't in decoded mode.
   */
  async wholeText(
    path: string,
    source: string,
  ): Promise<{ text: string; missingSource: number } | null> {
    const mapping = this.active.get(path);
    if (!mapping) return null;
    // Attached, off-screen, so embeds render as they would in a view.
    const el = activeDocument.body.createDiv({ cls: DECODED_WHOLE_CLASS });
    el.setCssStyles({ position: "fixed", left: "-10000px", width: "800px" });
    const rendering = { path, mapping, missingSource: 0 };
    this.wholeRenderings.set(el, rendering);
    await MarkdownRenderer.render(this.app, restore(source, mapping), el, path, this.owner);
    await new Promise((resolve) => window.setTimeout(resolve, this.settleMs));
    const text = el.innerText;
    el.remove();
    return { text, missingSource: rendering.missingSource };
  }

  /** Checks what a view of `path` shows, given the text of its rendered page. */
  check(path: string, renderedText: string): CompletenessResult {
    const mapping = this.active.get(path);
    const remaining = mapping ? remainingPlaceholders(renderedText, mapping) : [];
    const sectionsWithoutSource = this.missingSource.get(path) ?? 0;
    return {
      complete: mapping !== undefined && remaining.length === 0 && sectionsWithoutSource === 0,
      remaining,
      sectionsWithoutSource,
    };
  }
}
