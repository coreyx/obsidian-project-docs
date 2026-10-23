/**
 * A stand-in for the `obsidian` module in unit tests, which run outside Obsidian. It grows with the
 * plugin: each class or function here is the smallest shape the code under test relies on.
 */

/** Obsidian's base class for anything with a lifecycle. */
export class Component {
  load(): void {}
  unload(): void {}
}

/** Obsidian's base class for plugins. */
export class Plugin extends Component {
  onload(): void | Promise<void> {}
  onunload(): void {}
}

/** A post-processor's view of one rendered section, as the real one hands it. */
export type PostProcessor = (el: HTMLElement, ctx: unknown) => Promise<void> | void;

/**
 * Renders Markdown as plain paragraphs, one per line, and records each call. Tests can set
 * `onRender` to act as Obsidian does after rendering, such as running post-processors.
 */
export const MarkdownRenderer = {
  calls: [] as { markdown: string; sourcePath: string }[],
  onRender: undefined as ((el: HTMLElement, sourcePath: string) => Promise<void>) | undefined,
  async render(
    _app: unknown,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    _component: Component,
  ): Promise<void> {
    this.calls.push({ markdown, sourcePath });
    for (const line of markdown.split("\n")) {
      const p = document.createElement("p");
      p.textContent = line;
      el.appendChild(p);
    }
    await this.onRender?.(el, sourcePath);
  },
};
