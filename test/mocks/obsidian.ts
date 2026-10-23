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

/** Obsidian's toast message; every message shown is kept in `shown`. */
export class Notice {
  static shown: string[] = [];

  constructor(message: string) {
    Notice.shown.push(message);
  }
}

/** A button in a Setting, with the handlers tests click. */
export class ButtonComponent {
  text = "";
  buttonEl = document.createElement("button");
  private handler: (() => unknown) | undefined;

  setButtonText(text: string): this {
    this.text = text;
    return this;
  }

  setCta(): this {
    return this;
  }

  onClick(handler: () => unknown): this {
    this.handler = handler;
    return this;
  }

  click(): void {
    this.handler?.();
  }
}

/** A row of controls; only buttons are used. */
export class Setting {
  static buttons: ButtonComponent[] = [];

  constructor(public containerEl: HTMLElement) {}

  addButton(build: (button: ButtonComponent) => unknown): this {
    const button = new ButtonComponent();
    build(button);
    Setting.buttons.push(button);
    return this;
  }
}

/** A dialog. Opening runs onOpen; closing runs onClose, as in Obsidian. */
export class Modal {
  static opened: Modal[] = [];
  contentEl = document.createElement("div");
  title = "";

  constructor(public app: unknown) {}

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  open(): void {
    Modal.opened.push(this);
    void this.onOpen();
  }

  close(): void {
    this.onClose();
  }

  onOpen(): void | Promise<void> {}
  onClose(): void {}
}

/** One item of a menu, with what it was given. */
export class MenuItem {
  title = "";
  icon: string | null = null;
  checked: boolean | null = null;
  section = "";
  handler: (() => unknown) | undefined;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }

  setChecked(checked: boolean | null): this {
    this.checked = checked;
    return this;
  }

  setSection(section: string): this {
    this.section = section;
    return this;
  }

  onClick(handler: () => unknown): this {
    this.handler = handler;
    return this;
  }
}

/** A menu that keeps its items. */
export class Menu {
  items: MenuItem[] = [];

  addItem(build: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    build(item);
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(): this {
    return this;
  }
}
