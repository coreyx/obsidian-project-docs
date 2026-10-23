/**
 * A stand-in for the `obsidian` module in unit tests, which run outside Obsidian. It grows with the
 * plugin: each class or function here is the smallest shape the code under test relies on.
 */

/** Obsidian's base class for anything with a lifecycle. */
export class Component {
  load(): void {}
  unload(): void {}
}

/** A file in the vault: its path, and the parts of it Obsidian derives from the path. */
export class TFile {
  constructor(public path: string) {}

  get name(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }

  get extension(): string {
    const dot = this.name.lastIndexOf(".");
    return dot === -1 ? "" : this.name.slice(dot + 1);
  }
}

/** The vault's access to the filesystem on desktop. */
export class FileSystemAdapter {
  constructor(private readonly basePath = "") {}

  getBasePath(): string {
    return this.basePath;
  }
}

/** Obsidian's event emitter. */
export class Events {
  private readonly handlers = new Map<string, ((...data: unknown[]) => unknown)[]>();

  on(name: string, callback: (...data: unknown[]) => unknown): { name: string } {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), callback]);
    return { name };
  }

  trigger(name: string, ...data: unknown[]): void {
    for (const callback of this.handlers.get(name) ?? []) callback(...data);
  }
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
