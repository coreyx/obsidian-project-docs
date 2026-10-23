---
status: approved
---

# The Project Docs Obsidian plugin

The Obsidian half of Project Docs. It does four things:
- marks and tracks private notes and attachments;
- changes sync rules with the mouse;
- shows the sync engine's status;
- shows coded notes with their real values, read-only.

It never syncs. The VS Code extension and the `project-docs` command line do that, using the same core library this plugin installs from npm. The requirements and the architecture are already approved in the main spec, which this plan links rather than restates. It covers the acceptance criteria the plugin owns: 9.1, 9.3, 10.1, 10.3, 10.6, 11.3, 14.3, 15.3, 17.2 and 2.10, and the plugin side of 2.4 and 2.8.

**Related documents**
- [Product](https://github.com/coreyx/vscode-project-docs/blob/main/spec/vscode-project-docs/product.md)
- [Requirements](https://github.com/coreyx/vscode-project-docs/blob/main/spec/vscode-project-docs/requirements.md)
- [Design](https://github.com/coreyx/vscode-project-docs/blob/main/spec/vscode-project-docs/design.md)

These links are absolute because the documents are in another repo; relative links between repos don't work on GitHub. The plugin's components are the "Obsidian plugin" table in the design's Architecture section. Its decisions are 7 (vault metadata), 8 (the plugin never syncs), 14 (the decoded view) and 17 (confirmations).

## User Review Required

> [!IMPORTANT]
> **A prototype gates the decoded view (design decision 14).** TASK-3 tries decoding in reading view on notes with callouts, embeds, tables, footnotes and code blocks.
> - **If the completeness check passes** on ordinary notes, reading view is the default.
> - **If it fails**, the separate read-only view becomes the default. I bring REQ-14.0.2's "in reading view" wording back to you before TASK-11 builds on it.
>
> Either way, nothing partly decoded is ever left on screen.

> [!IMPORTANT]
> **The plugin edits notes on its own** in exactly two cases:
> - It adds `project-docs: private` to a Markdown file that arrives in a project's private folder (REQ-10.0.3, 10.0.4).
> - It writes the rule you pick from a menu.
>
> Both go through the core's writer, which changes only that property and leaves every other byte alone (REQ-9.2). It writes nothing else in your notes.

> [!NOTE]
> **The core is pinned** to the exact version published to npm (`0.1.0`), since `0.x` releases may change the API. The plugin bundles it into `main.js`, as Obsidian requires.

> [!NOTE]
> **End-to-end tests run in a real, sandboxed Obsidian** through [wdio-obsidian-service](https://webdriver.io/docs/wdio-obsidian-service).
> - **In CI:** on Linux, on every push.
> - **Windows, macOS and WSL:** checked by hand in TASK-31 of the main spec.
> - **Unit tests:** cover the logic with Obsidian's API stubbed, and run on all three systems.

## Open Questions

None at this time. Details that don't change the plan are settled in the task that meets them, such as the exact `minAppVersion` (TASK-1) and the indicator's icon (TASK-9).

## Proposed Changes

### Repository and build

#### [NEW] `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `eslint.config.mjs`, `.prettierrc.json`, `manifest.json`, `versions.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `.gitignore`, `.specdevship/current-spec`
- [x] **TASK-1:** Scaffold the plugin from the shape of Obsidian's sample plugin.
  - **Manifest:** id `project-docs`, name `Project Docs`, `isDesktopOnly: true`, and `minAppVersion` set to the oldest Obsidian version whose API covers every call the plugin makes.
  - **Dependencies:** `@specdevship/project-docs-core` at exactly `0.1.0`; `obsidian` as a type dependency.
  - **Build:** esbuild bundling `src/main.ts` to CommonJS `main.js`, with `obsidian`, `electron`, `@codemirror/*` and Node's built-ins external.
  - **Checks:** TypeScript in strict mode; ESLint with `eslint-plugin-obsidianmd`, the community rules reviewers use; Prettier.
  - **Tests:** Vitest with V8 coverage, at 70–85% line and 60–80% branch, and 90%+ for `src/privacy/`.
  - **Repo files:** an MIT `LICENSE` (Corey Struzan), a README stub, a CHANGELOG with `## [Unreleased]`, and a `.gitignore`.

#### [NEW] `.github/workflows/ci.yml`
- [x] **TASK-2:** CI on every push and pull request.
  - **Every system:** lint, typecheck, build and unit tests with coverage on `windows-latest`, `macos-latest` and `ubuntu-latest`. The build fails below the coverage thresholds.
  - **Linux:** the end-to-end tests under `xvfb`, against the `minAppVersion` and the latest Obsidian.

### The decoded-view prototype

#### [NEW] `src/decode/reading.ts`, `test/e2e/vault/prototype/*.md`, `spec/project-docs-plugin/prototype.md`
- [x] **TASK-3:** Prototype reading-view decoding (design decision 14).
  - A Markdown post-processor that takes each rendered section's source lines through `ctx.getSectionInfo(el)`, decodes them with the core's `restore()`, and re-renders the section with `MarkdownRenderer.render`.
  - Then the completeness check: run `placeholderPattern()` for every mapped placeholder over the view's rendered text, and confirm that every section had source info.
  - Run it end to end on test notes with callouts, embeds of other notes, tables, footnotes, fenced code, inline code and a placeholder split across formatting.
  - Record in `prototype.md` which pass, which fail and why, and the resulting default: reading view or the fallback view. **Stop and report to you before TASK-11.**

### Finding projects and their settings

#### [NEW] `src/projects.ts`
- [x] **TASK-4:** `ProjectIndex`, which finds every linked project in the vault and keeps up to date as notes change.
  - A project is a folder whose folder note has `project-docs-id` and `project-docs-repo` in its frontmatter, read from `app.metadataCache`.
  - For each project, it reads `.project-docs.json` from the repo with the core's `readLink()`, to get `privateSubfolder` and `syncAttachments`. While the repo can't be reached (a disconnected drive, WSL not running), it assumes the safe defaults: private folder `private`, and attachments treated as possibly private.
  - `projectFor(file)` returns a file's project and its key in the project folder, or null.
  - Several projects in one vault work independently.

### Privacy

#### [NEW] `src/privacy/marker.ts`
- [x] **TASK-5:** `PrivateMarker` (REQ-10.0.3 to 10.0.5).
  - On vault `create`, and on `rename` into a private folder, it sets `project-docs: private` on a Markdown file that lacks it. It writes with `app.vault.process()` and the core's `setRule()`, so only that property changes.
  - When the layout is ready, it sweeps every project's private folder to mark files that arrived while Obsidian was closed (REQ-10.3).
  - It never removes a marker. A note moved out keeps it (REQ-10.0.5).
  - Its own writes don't trigger it again.

#### [NEW] `src/privacy/private-files.ts`
- [x] **TASK-6:** `PrivateFilesList` (REQ-11.0.3), for projects with attachment sync on.
  - It records `{ path, sha256 }` for each non-Markdown file created in, or moved into, the private folder. The hash is the core's `sha256()` of the raw bytes.
  - It follows recorded files through renames anywhere in the project, and updates the hash when a recorded file changes in Obsidian.
  - Its startup sweep records unrecorded files in the private folder.
  - It writes `.project-docs/private-files.json` with the core's `serializePrivateFilesList()`, atomically, and only when the list changes.

#### [NEW] `src/privacy/confirmations.ts`
- [x] **TASK-7:** `Confirmations` (design decision 17).
  - `confirm(file, text)` adds `{ path, sha256: markdownHash(text) }` to `.project-docs/confirmations.json`, using the core's `parseConfirmations()` and `serializeConfirmations()`.
  - `prune()` removes an entry once its note is deleted, its content no longer matches the hash, or `status.json` no longer reports it as `was-private`.

### Sync rules with the mouse

#### [NEW] `src/rules/menu.ts`, `src/rules/confirm-modal.ts`
- [x] **TASK-8:** `RuleMenu` file-menu items (REQ-9.0.2, 9.1).
  - Right-clicking a project's Markdown file shows a "Sync rule" submenu with `sync`, `repo-to-vault`, `repo-only` and `private`, the current one checked. That's three clicks from the file.
  - Choosing a rule writes it with the core's `setRule()` through `vault.process()`.
  - **From `private` to any other rule:** first opens `ConfirmUnprivateModal`. It names the note and says it will be copied into the repo at `<docs folder>/<key>`, with "Sync to Repo" and "Cancel" buttons (REQ-9.0.4, 9.3).
    - **Confirming:** writes the rule and calls `Confirmations.confirm()` with the new text, so VS Code doesn't ask again (REQ-10.6).
    - **Cancelling:** changes nothing.
  - Files in the private folder offer no rule other than `private`, since the folder keeps them private whatever their frontmatter says (REQ-10.0.1).

#### [NEW] `src/rules/indicator.ts`
- [x] **TASK-9:** The current note's rule in the status bar and as a header action on Markdown views (REQ-9.0.1, 9.0.3). Clicking either opens the same choices as the menu, with the same confirmation.

### Status

#### [NEW] `src/status/reader.ts`, `src/status/banner.ts`
- [x] **TASK-10:** `StatusReader` (REQ-17.0.3, 17.2).
  - It reads each project's `.project-docs/status.json` with the core's `parseStatusFile()` when the file changes.
  - It shows the overall state in the status bar: "Up to date", or "N need attention" with a tooltip listing them.
  - For the open note, it shows a banner at the top of the view when the note is held back, in conflict or waiting as `was-private`. The banner gives the item's message and reasons, which never contain real values. For `was-private`, it offers "Sync to Repo…", which uses TASK-8's modal.

### Decoded view

#### [NEW] `src/decode/private-md.ts`, `src/decode/view.ts`, `src/decode/fallback-view.ts`
- [x] **TASK-11:** `DecodedView` (REQ-14.0.2 to 14.0.6, 15.0.5, 15.3), built on TASK-3's result.
  - **The toggle:** a header action on every Markdown note in a project whose repo has a PRIVATE.md, so it's visible without opening a menu.
  - **Reading PRIVATE.md:** read from the repo path in the folder note with the core's `loadPlaceholders()`, never copied into the vault. That includes `\\wsl.localhost\...` paths.
  - **Decoded mode:**
    - decodes in reading view, or opens the read-only fallback view, whichever TASK-3 made the default;
    - shows a fixed "Decoded: real values shown" header and a status-bar indicator. Coded notes show "Coded".
  - **Errors, missing PRIVATE.md included:** shows the standard's message and decodes nothing (REQ-14.0.5).
  - **An empty table:** shows the note as it is, with the "no placeholders yet" note.
  - **Nothing written:** the decoded text never reaches a file, and the note's text is never changed.

### Plugin entry point and documentation

#### [NEW] `src/main.ts`
- [x] **TASK-12:** `ProjectDocsPlugin`, which wires the components together. It registers every event, view, command and post-processor through the plugin's `register*` methods, so unloading the plugin removes all of them, and does nothing in a vault with no linked project.

#### [MODIFY] `README.md`
- [x] **TASK-13:** The user guide.
  - **What it does:** what the plugin does, and that it never syncs.
  - **The private folder:** how private notes and the private folder work.
  - **Changing rules:** with the menu, the status bar and the header.
  - **The decoded view.**
  - **What it reads and writes:** the folder note's properties, and `.project-docs/`.
  - **Deep links:** `uid: <project id>` belongs in the project folder's folder note (REQ-2.0.11, 2.10).
  - **Privacy statement for the store:** the plugin makes no network requests and reads files only in the vault and the linked repo.

### Tests and release

#### [NEW] `test/unit/*.test.ts`, `test/e2e/*.e2e.ts`, `wdio.conf.mts`
- [x] **TASK-14:** End-to-end tests in a sandboxed vault with a linked test repo. Each test names its criterion:
  - **10.1:** a note created in `private/` gets the marker within 2 seconds.
  - **10.3:** a file placed there before Obsidian starts is marked on start.
  - **9.1 and 9.3:** every rule change from the file menu takes at most three clicks, and cancelling un-privating leaves the note private.
  - **10.6:** confirming writes the rule and a matching `confirmations.json` entry.
  - **11.3:** with attachment sync on, a PNG put in `private/`, moved, renamed and copied keeps its path or hash on the list.
  - **17.2:** a `status.json` with a held-back item shows the banner.
  - **14.3 and 15.3:** decoded mode shows real values with the indicator, the toggle is visible without a menu, and no file changes.

  Unit tests cover the logic behind each component.

#### [NEW] `.github/workflows/release.yml`
- [x] **TASK-15:** On a version tag you push, build the plugin and attach `main.js`, `manifest.json` and `styles.css` to a draft GitHub release, after checking that the tag matches `manifest.json`'s version. Add the `version` script that bumps `manifest.json` and `versions.json` together. Publishing to the store stays TASK-31 of the main spec.

### Settings (added in a revision, 2026-10-23)

#### [NEW] `src/settings.ts`; [MODIFY] `src/main.ts`, `src/rules/indicator.ts`, `src/status/banner.ts`, `README.md`
- [ ] **TASK-16:** A settings tab, `ProjectDocsSettingTab`, with two sections.
  - **Linked projects, read-only:** for each project in the vault, its folder, its repo path, and whether the repo can be read right now (or that the safe defaults apply). Also its private folder, attachment sync and docs folder. A note says these come from the repo's committed `.project-docs.json`, shared with VS Code, the command line and anyone who clones the repo, so they're changed there and never from Obsidian. With no project, it says how to link one from VS Code.
  - **Display options:** toggles for the rule in the status bar, the rule icon in note headers, the sync status in the status bar, and the banners on notes. They're kept with `Plugin.saveData` and apply at once. All default to on, which is what REQ-9.0.1, 17.0.3 and 17.2 require; turning one off is the user's choice for their own Obsidian.
  - **Not hideable:** the "Decoded: real values shown" indicator (REQ-14.0.4) and the decoded-view toggle (REQ-15.0.5), since they're what tells the user real values are on screen.
  - **README:** a Settings section.
  - **Tests:** unit tests for loading settings (defaults, unknown and wrong-typed values ignored) and for the tab's content. An end-to-end test that the tab lists the fixture's project, and that turning off the sync status hides its status bar item.

## Verification Plan

### Automated Tests
- `npm test` runs the Vitest unit suite, with coverage at the targets in TASK-1, on Windows, macOS and Linux in CI.
- `npm run test:e2e` runs TASK-14's end-to-end tests in a real Obsidian. Locally that's this machine; in CI, Linux.

### Manual Verification
1. Link a repo with the VS Code extension. Then, in Obsidian, open the project's folder note and click "Open the repo in VS Code". Confirm that VS Code opens the repo (the plugin side of REQ-2.4). The rest of 2.4 is TASK-31's check on each system.
2. In a vault whose project folder already has a folder note with its own content, link from VS Code. Confirm the plugin finds the project from that note, and the note's content is untouched (the plugin side of REQ-2.8).
3. With a repo in WSL and Obsidian on Windows, toggle decoded on a coded note, and confirm real values appear from the WSL repo's PRIVATE.md.
4. Right-click a private note outside `private/`, choose `sync` and confirm. VS Code's Project Docs view then shows no "was private" item for it, and the note reaches the repo with no second prompt (REQ-10.6).
5. Disable the plugin and confirm that no status bar items, header actions, banners or decoded views remain.

## Visual design application

No `design-system.md` or `art-bible.md` exists for Project Docs. The plugin uses Obsidian's own components (menus, the status bar, header actions, modals, `Notice`) and its CSS variables, so it looks like the rest of Obsidian in every theme. `styles.css` holds only the banner's and the decoded header's layout, built from those variables.
