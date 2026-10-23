# Project Docs for Obsidian

The Obsidian half of [Project Docs](https://github.com/coreyx/vscode-project-docs), which keeps a repo's docs folder and a folder in your vault in sync on the same machine.

This plugin never syncs anything itself. The Project Docs VS Code extension, or its `project-docs` command line, does the syncing. The plugin covers what happens inside Obsidian:

- it keeps private notes private, including attachments;
- it lets you change a note's sync rule with the mouse;
- it shows the sync status and any problems on the notes they concern;
- it shows notes that use [PRIVATE.md](https://github.com/coreyx/private-md-standard) placeholders with their real values, read-only.

It needs Obsidian 1.13.4 or later on the desktop.

## Install

The plugin isn't in the community plugin store yet. Until it is, install the beta with [BRAT](https://github.com/TfTHacker/obsidian42-brat), which installs plugins from their GitHub releases and keeps them up to date:

1. In Obsidian, open **Settings**, then **Community plugins**. Install and enable **BRAT**.
2. In BRAT's settings, choose **Add beta plugin**.
3. Enter `https://github.com/coreyx/obsidian-project-docs`, choose the latest version, and choose **Add plugin**.
4. If **Project Docs** isn't enabled yet, enable it under **Community plugins**.

BRAT checks for newer beta releases and updates the plugin, at startup if you turn that on in its settings.

## Getting started

1. Link a repo to a folder in your vault with the VS Code extension's **Project Docs: Link to Obsidian**. That creates the project folder's folder note, the **link note**, which records the repo's path.
2. Install and enable this plugin (see [Install](#install)). It finds every linked project in the vault from its link note, and reads the project's settings from the repo's `.project-docs.json`.

While the repo can't be read, for example on a disconnected drive, the plugin assumes the settings that protect the most: the private folder is `private`, and attachments are tracked.

## Private notes

Everything in a project's private folder (`private` by default) stays in the vault: syncing never copies it to the repo.

- **A note that arrives in the private folder is marked private.** That applies whether you create it there, move it there or copy it in another way. Within two seconds, the plugin adds `project-docs: private` to its frontmatter, and changes nothing else in the note.
- **Notes copied in while Obsidian was closed** are marked when it next starts.
- **A note moved out of the private folder keeps its marker,** so it stays private wherever it goes.
- **If a note's frontmatter can't be edited safely,** the plugin leaves it and says so. The private folder still keeps it out of the repo.

**Attachments** can't carry a marker. Where attachment sync is on (`syncAttachments` in `.project-docs.json`), the plugin records every file that arrives in the private folder, with a hash of its contents, in `.project-docs/private-files.json` in the project folder. It follows a recorded file when it's renamed, moved or edited, so a private image moved anywhere in the project, renamed or copied still never reaches the repo. A deleted file keeps its record, so a copy made before it was deleted stays protected.

## Sync rules

Each note's sync rule is set by the `project-docs` property in its frontmatter:

| Rule            | What happens                                                                |
| --------------- | --------------------------------------------------------------------------- |
| `sync`          | Edits in either app are copied to the other. The default.                   |
| `repo-to-vault` | The repo's copy wins. Edits made in Obsidian are reported, not copied back. |
| `repo-only`     | Never copied to the vault.                                                  |
| `private`       | The note never reaches the repo.                                            |

You don't need to type it. A project note's rule shows in the status bar and as an icon in the note's header. Right-click the note, click the status bar item or click the icon, and choose a rule. Only that one property changes.

**Making a private note syncable asks first.** The dialog names the note and where in the repo it will be copied, since that is the one change that sends content to the repo. Cancelling, or closing the dialog, leaves the note private. Once you confirm, the plugin records your answer in `.project-docs/confirmations.json`, so VS Code doesn't ask you again.

A note in the private folder is always private, so it's offered no other rule.

## Status and problems

The status bar shows **Project Docs: up to date**, how many items **need attention** or, before the first sync, **not synced yet**. Hover over it to see the items.

A note that the sync has a problem with shows a banner at the top, with the reason. For example:

- a change held back from the repo, because it links to a private note or contains a real value from PRIVATE.md;
- a conflict waiting in VS Code;
- a note that was private and lost its marker some other way, such as by hand or by an agent rewriting it. It waits for your say-so: **Sync to repo…** asks, as above.
- a note that stopped syncing because git now ignores its folder, or the note itself. Both copies stay as they are. **Keep syncing it** adds the folder to the repo's `syncIgnored` setting, and edits made on either side in the meantime then sync. **Stop syncing it** leaves it out of the sync and clears the banner. In `node_modules`, which never syncs, only **Stop syncing it** is offered. Either way, the sync carries out your choice on its next pass.

The status comes from `.project-docs/status.json`, which the sync writes after every pass. It never contains a real value.

## Decoded view

In a project whose repo uses PRIVATE.md, a note's header has an eye icon. Click it, or run **Project Docs: Toggle decoded view**, to show the note with its real values. The decoded view replaces the note in the same tab, and the eye icon in its header switches back.

- **It's read-only.** It renders the note; nothing can be typed into it, and nothing is ever written to a file.
- **You always know which mode is showing.** The decoded view has a fixed **Decoded: real values shown** header, and so do its tab title and the status bar. A coded note shows **Coded** in the status bar.
- **The whole note is decoded,** with the standard's rules. Properties show decoded in a read-only table. Embedded notes are decoded from their own files.
- **Nothing partly decoded is ever shown.** If PRIVATE.md is missing or can't be read, the view shows the reason and nothing else. If anything on the page would still show a placeholder, for example in a note embedded from outside the project, the view shows that instead of the page.
- **A PRIVATE.md with an empty table** shows the note as it is, with a note saying it has no placeholders yet.

The plugin reads PRIVATE.md from the repo, through the path in the link note. It never copies it into the vault.

## Deep links

If the project uses Advanced URI deep links, which the VS Code extension sets up, **`uid: <project id>` belongs in the project folder's folder note**. That anchors the link to the project folder rather than to whichever note happens to hold it, so it keeps working however the folder's contents change. If you add the `uid` yourself, put it there.

## Settings

The plugin's tab in Obsidian's settings has two parts:

- **Linked projects** lists each project in the vault with its repo, docs folder, private folder and whether attachment sync is on. These are shown read-only: they live in the repo's committed `.project-docs.json`, shared with VS Code, the command line and anyone who clones the repo, so change them there.
- **Display** turns each of these on or off: the sync rule in the status bar, the sync rule icon in note headers, the sync status in the status bar, and banners on notes. All are on to begin with, and a change applies at once.

The decoded view's toggle, and the status bar item that says when real values are on screen, are always shown.

## What it reads and writes

- **Reads:**
  - the link note's `project-docs-id` and `project-docs-repo` properties;
  - the repo's `.project-docs.json` and `PRIVATE.md`;
  - each project folder's `.project-docs/status.json`.
- **Writes:**
  - the `project-docs` property of a note, when it arrives in a private folder or when you choose a rule;
  - `.project-docs/private-files.json`, `.project-docs/confirmations.json` and `.project-docs/ignored-choices.json` in the project folder.
  - its display settings, in Obsidian's usual place for a plugin's settings (`data.json` in the plugin's folder).

Obsidian hides the `.project-docs` folder, and syncing never copies it to the repo.

The plugin makes no network requests. It reads files only in your vault and in the repos it's linked to.

## Development

Requires Node 22 or newer and [pnpm](https://pnpm.io). The pnpm version is pinned in `package.json`, and pnpm switches to it on its own.

```sh
pnpm install
pnpm run build
pnpm test
pnpm run test:e2e
```

`pnpm run test:e2e` downloads Obsidian into `.obsidian-cache/` and runs the end-to-end tests in a sandboxed copy of it. `pnpm version <version>` updates `manifest.json` and `versions.json`, commits and tags; pushing the tag builds the release.

## License

MIT
