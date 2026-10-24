/**
 * The plugin's settings tab (TASK-16). It shows the vault's linked projects and their sync
 * settings read-only, since those live in each repo's committed `.project-docs.json`, shared with
 * VS Code, the command line and anyone who clones the repo. The only settings kept here are the
 * plugin's own display options.
 */
import {
  PluginSettingTab,
  type App,
  type Plugin,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import type { Project, ProjectIndex } from "./projects.js";

/** Which of the plugin's displays are shown. */
export interface DisplaySettings {
  /** The current note's sync rule in the status bar (REQ-9.0.1). */
  ruleInStatusBar: boolean;
  /** The sync rule icon in note headers (REQ-9.0.1). */
  ruleInHeader: boolean;
  /** The overall sync status in the status bar (REQ-17.0.3). */
  statusInStatusBar: boolean;
  /** The banners on notes the sync has a problem with (REQ-17.2). */
  banners: boolean;
}

/** Everything shown, which is what the requirements ask for. */
export const DEFAULT_SETTINGS: DisplaySettings = {
  ruleInStatusBar: true,
  ruleInHeader: true,
  statusInStatusBar: true,
  banners: true,
};

/** True when `key` names one of the display settings. */
function isDisplayKey(key: string): key is keyof DisplaySettings {
  return Object.hasOwn(DEFAULT_SETTINGS, key);
}

/** The saved settings, with the default for anything missing or not a true or false value. */
export function readSettings(data: unknown): DisplaySettings {
  const saved = (data ?? {}) as Partial<Record<keyof DisplaySettings, unknown>>;
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof DisplaySettings)[]) {
    const value = saved[key];
    if (typeof value === "boolean") settings[key] = value;
  }
  return settings;
}

/** What the tab needs from the plugin. */
export interface SettingsHost extends Plugin {
  readonly displaySettings: DisplaySettings;
  readonly projects: ProjectIndex;
  /** Saves the settings and applies them at once. */
  saveSettings(): Promise<void>;
}

/** The toggles, in the order shown. */
const TOGGLES: readonly { key: keyof DisplaySettings; name: string; desc: string }[] = [
  {
    key: "ruleInStatusBar",
    name: "Sync rule in the status bar",
    desc: "The open note's sync rule. Click it to change the rule.",
  },
  {
    key: "ruleInHeader",
    name: "Sync rule icon in note headers",
    desc: "An icon for each project note's sync rule. Click it to change the rule.",
  },
  {
    key: "statusInStatusBar",
    name: "Sync status in the status bar",
    desc: "Whether everything is up to date, or how many items need attention.",
  },
  {
    key: "banners",
    name: "Banners on notes",
    desc: "A banner at the top of a note the sync has a problem with, such as a change held back from the repo.",
  },
];

/** A project's settings, as one line per fact. */
export function projectFacts(project: Project): string[] {
  return [
    `Repo: ${project.repoPath}`,
    project.reachable
      ? `Docs folder in the repo: ${project.docsFolder || "the repo root"}`
      : "The repo can't be read right now, so the plugin uses the settings that protect the most.",
    // With the repo root linked, every root file is already in the docs folder.
    ...(project.docsFolder
      ? [`Root files: ${project.rootFiles.length > 0 ? project.rootFiles.join(", ") : "none"}`]
      : []),
    project.reachable
      ? `Private folder: ${project.privateFolder}`
      : `Private folder: ${project.privateSubfolder}, inside the docs folder`,
    `Attachment sync: ${project.syncAttachments ? "on" : "off"}`,
  ];
}

/** The plugin's tab in Obsidian's settings, built from definitions so its settings are searchable. */
export class ProjectDocsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsHost,
  ) {
    super(app, host);
  }

  /** The tab's content. The plugin calls `update()` when the project list changes, to ask again. */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { type: "group", heading: "Linked projects", items: this.projectItems() },
      {
        type: "group",
        heading: "Display",
        items: [
          ...TOGGLES.map(({ key, name, desc }): SettingDefinition => ({
            name,
            desc,
            control: { type: "toggle", key, defaultValue: DEFAULT_SETTINGS[key] },
          })),
          {
            name: "Decoded view",
            desc: "The decoded view's toggle, and the status bar item that says when real values are on screen, are always shown.",
          },
        ],
      },
    ];
  }

  /** The toggles read the plugin's `displaySettings`, rather than the default `settings`. */
  override getControlValue(key: string): unknown {
    return isDisplayKey(key) ? this.host.displaySettings[key] : undefined;
  }

  /** Saves a toggle's new value, which also applies it to every open view. */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!isDisplayKey(key) || typeof value !== "boolean") return;
    this.host.displaySettings[key] = value;
    await this.host.saveSettings();
  }

  /** One read-only row per linked project, after a note on where their settings live. */
  private projectItems(): SettingDefinition[] {
    const where: SettingDefinition = {
      name: "Where these settings live",
      desc: "In each repo's .project-docs.json, which is committed and shared with VS Code, the command line and anyone who clones the repo. Change them there.",
      searchable: false,
    };
    const projects = this.host.projects.projects;
    if (projects.length === 0) {
      return [
        where,
        {
          name: "No linked projects",
          desc: "Link one with the Link to Obsidian command in VS Code.",
        },
      ];
    }
    return [
      where,
      ...projects.map((project): SettingDefinition => ({
        name: project.folder === "" ? "The vault's root folder" : project.folder,
        desc: createFragment((fragment) => {
          for (const fact of projectFacts(project)) fragment.createDiv({ text: fact });
        }),
      })),
    ];
  }
}
