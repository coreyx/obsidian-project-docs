/**
 * The Project Docs plugin's entry point. The components (private markers, the private-files list,
 * sync rules, status and decoded views) are wired in here as they are added; the plugin never runs
 * sync passes itself (design decision 8).
 */
import { Plugin } from "obsidian";
import { ReadingViewDecoder } from "./decode/reading.js";

/** The plugin Obsidian loads from main.js. */
export default class ProjectDocsPlugin extends Plugin {
  /** Decodes notes in reading view; turned on per note by the decoded view (TASK-11). */
  readingDecoder!: ReadingViewDecoder;

  override onload(): void {
    // Components are registered here, through the plugin's register* methods, so unloading the
    // plugin removes every one of them.
    this.readingDecoder = new ReadingViewDecoder(this.app, this);
    this.registerMarkdownPostProcessor(this.readingDecoder.process);
  }
}
