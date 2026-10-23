/**
 * The Project Docs plugin's entry point. The components (private markers, the private-files list,
 * sync rules, status and decoded views) are wired in here as they are added; the plugin never runs
 * sync passes itself (design decision 8).
 */
import { Plugin } from "obsidian";

/** The plugin Obsidian loads from main.js. */
export default class ProjectDocsPlugin extends Plugin {
  override onload(): void {
    // Components are registered here, through the plugin's register* methods, so unloading the
    // plugin removes every one of them.
  }
}
