/**
 * A stand-in for the `obsidian` module in unit tests, which run outside Obsidian. It grows with the
 * plugin: each class or function here is the smallest shape the code under test relies on.
 */

/** Obsidian's base class for plugins. */
export class Plugin {
  onload(): void | Promise<void> {}
  onunload(): void {}
}
