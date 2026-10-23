/**
 * The DOM helpers Obsidian adds to every element and to the window, recreated for unit tests that
 * run in happy-dom. Only the ones the plugin uses are here, with the same behavior.
 */

interface ElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
}

/** Creates an element as Obsidian's `createEl` does, from its options. */
function build<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  info?: ElementInfo | string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const options: ElementInfo = typeof info === "string" ? { cls: info } : (info ?? {});
  const classes = typeof options.cls === "string" ? options.cls.split(" ") : (options.cls ?? []);
  for (const cls of classes.filter(Boolean)) el.classList.add(cls);
  if (options.text !== undefined) el.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
  return el;
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

proto.empty = function (this: HTMLElement) {
  this.replaceChildren();
};
proto.createEl = function (
  this: HTMLElement,
  tag: keyof HTMLElementTagNameMap,
  info?: ElementInfo | string,
) {
  return this.appendChild(build(tag, info));
};
proto.createDiv = function (this: HTMLElement, info?: ElementInfo | string) {
  return this.appendChild(build("div", info));
};
proto.createSpan = function (this: HTMLElement, info?: ElementInfo | string) {
  return this.appendChild(build("span", info));
};
proto.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(this.style, styles);
};
proto.setText = function (this: HTMLElement, text: string) {
  this.textContent = text;
};
proto.addClass = function (this: HTMLElement, ...classes: string[]) {
  this.classList.add(...classes);
};
proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
  this.classList.remove(...classes);
};
proto.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean) {
  for (const cls of typeof classes === "string" ? [classes] : classes) {
    this.classList.toggle(cls, value);
  }
};

const scope = window as unknown as Record<string, unknown>;
scope.activeDocument = document;
scope.activeWindow = window;
scope.createDiv = (info?: ElementInfo | string) => build("div", info);
