# Walkthrough: The Project Docs Obsidian plugin

The Obsidian half of Project Docs, built against `@specdevship/project-docs-core` 0.1.0 from npm. It does four things:
- marks private notes, and tracks private attachments;
- changes sync rules with the mouse, asking before a private note becomes syncable;
- shows the sync engine's status, with a banner on the notes it concerns;
- shows a note decoded, read-only, in a separate view.

It never syncs. The user guide is the [README](../../README.md).

## What was implemented

### 1. Repository, build and release (TASK-1, TASK-2, TASK-15)
- **Manifest:** `manifest.json` (`project-docs`, desktop only, `minAppVersion` 1.8.7) and `versions.json`.
- **Build:** esbuild bundles the core into `main.js`. TypeScript runs in strict mode, with ESLint using `eslint-plugin-obsidianmd` (the store reviewers' rules) and Prettier.
- **Unit tests:** Vitest in happy-dom, with Obsidian's DOM helpers recreated (`test/mocks/dom.ts`) and a stand-in `obsidian` module (`test/mocks/obsidian.ts`).
- **CI (`.github/workflows/ci.yml`):** lint, format, build and unit tests with coverage on Windows, macOS and Linux. On Linux, the end-to-end tests run in a sandboxed Obsidian through wdio-obsidian-service, at 1.8.7 on its oldest installer and at the latest release.
- **Releases:** `.github/workflows/release.yml` builds a draft release from a bare version tag. `npm version` updates `manifest.json` and `versions.json` together.

### 2. The decoded-view prototype (TASK-3)
- **What it measured:** reading-view decoding, section by section, on ten notes in two Obsidian versions.
- **Result:** it failed on footnotes, properties and embedded notes, and on 1.8.7 the footnote definitions vanished while its own check passed.
- **What changed:** the separate read-only view became the default. You approved the change to REQ-14.0.2, AC 14.3 and design decision 14 in the main spec.
- **Records:** [prototype.md](prototype.md) and commit `ff84c07`. The prototype code was removed in TASK-11, and its notes became test notes.

### 3. Projects (TASK-4): `src/projects.ts`
- **Finding projects:** a project is found from its link note's `project-docs-id` and `project-docs-repo`.
- **Settings:** they come from the repo's `.project-docs.json`. While the repo can't be read, the protective defaults apply.

### 4. Privacy (TASK-5 to TASK-7): `src/privacy/`
- **`marker.ts`:** marks notes created in, moved into, or found on start in a private folder, changing only `project-docs`. It never removes a marker.
- **`private-files.ts`:** the private-files list, by path and hash. It follows renames and edits, keeps the records of deleted files, and never rewrites a list it can't read.
- **`confirmations.ts`:** records the notes you un-privated, by markdown hash. It prunes an entry once the repo holds exactly that content.
  - That's a deliberate deviation from the plan, which pruned by `status.json`: a status written before the engine saw the change would have pruned too early.
- **`../metadata.ts`:** atomic writes into the hidden `.project-docs/` folder.

### 5. Sync rules (TASK-8, TASK-9): `src/rules/`
- **`menu.ts`:** the four rules as file-menu items, two clicks from the note (Obsidian's API has no submenus).
- **`confirm-modal.ts`:** the dialog before a private note becomes syncable.
- **`indicator.ts`:** the rule in the status bar and in each note's header.

### 6. Status (TASK-10): `src/status/`
- **Reading:** `status.json` is read every three seconds.
- **Showing:** the status bar shows the overall state. A note the engine reports on gets a banner, with **Sync to repo…** for a note that was private.

### 7. Decoded view (TASK-11): `src/decode/`
- **`source.ts`:** decodes the body as one text with the standard's rules. Embeds are swapped for private-use tokens first, then rendered from their own files.
- **`render.ts`:** properties as a read-only table, and the completeness check.
  - The check reads every text node, hidden ones included. It doesn't use `textContent`, which joins neighboring elements: a unit test showed that hid a placeholder from the boundary rule.
- **`view.ts`:** the view in the same tab, its fixed header, the eye toggles, and the Coded/Decoded mode in the status bar.

### 8. Wiring and documentation (TASK-12, TASK-13)
- **`src/main.ts`:** registers everything through `Plugin.register*`. Vault events start once the layout is ready, after a sweep.
- **`README.md`:** the user guide, including that `uid: <project id>` belongs in the folder note (REQ-2.10), and exactly what the plugin reads and writes.

## Verification & test results

### Automated tests
- **Unit tests (`npm run coverage`):** 119 passed. Coverage is 97.4% of lines and 89.8% of branches; `src/privacy/` is above its 90% line threshold.
  - `src/main.ts` and `src/decode/view.ts` are excluded from unit coverage. They only wire components to Obsidian, and the end-to-end tests cover them.
- **End-to-end tests (`npm run test:e2e`):** 20 passed in Obsidian 1.8.7 (installer 1.5.8) and 20 in 1.14.5, both locally on Windows and in CI on Linux.

| Criterion | Test | Result |
|---|---|---|
| 10.1 | A note created in `private/` is marked within 2 seconds | Passed |
| 10.3 | A file copied into `private/` while Obsidian was closed is marked on start | Passed |
| 9.1 | Every rule is in the file menu, two clicks from the note | Passed |
| 9.3 | Un-privating asks; cancelling leaves the note private | Passed |
| 10.6 | Confirming writes the rule and a matching `confirmations.json` entry | Passed |
| 11.3 | A private PNG keeps its path or hash on the list through a move and a copy | Passed |
| 17.2 | A held-back item shows as a banner on the note, and in the status bar | Passed |
| 14.3, 15.3 | The eye shows without a menu; the decoded view shows real values with its indicator, in footnotes, properties and embeds too; no file changes | Passed |
| 14.4 | Without PRIVATE.md, the standard's error and nothing decoded | Passed |
| 15.4 | With an empty table, the note as it is, with the note | Passed |
| 2.10 | The README states that `uid: <project id>` belongs in the folder note | Done (documentation) |

### What failed along the way, and what was done
- **The end-to-end tests' first run:**
  - The menu tests failed on WebdriverIO's "element with this text" selectors under a parent. They now click by text in the page.
  - The attachment test failed because Obsidian's rename doesn't create the destination folder. The test creates it.
- **The confirm button's style:**
  - `setWarning` is deprecated, and the store's lint rules don't allow switching that check off.
  - `setDestructive` needs Obsidian 1.13, and the rules also flag it against the 1.8.7 minimum, even behind a feature check.
  - The button gets Obsidian's own `mod-warning` class instead.

## Manual verification
These need the VS Code extension and more than one machine, so they belong to TASK-31 of the main spec.
1. **Plugin side of REQ-2.4:** link a repo with the VS Code extension. In Obsidian, open the project's folder note and click **Open the repo in VS Code**. VS Code opens the repo.
2. **Plugin side of REQ-2.8:** in a vault whose project folder already has a folder note with its own content, link from VS Code. The plugin finds the project from that note (its status bar items appear on the folder's notes), and the note's own content is untouched.
3. **WSL:** with the repo in WSL and Obsidian on Windows, toggle decoded on a coded note. Real values appear, from the WSL repo's PRIVATE.md.
4. **No second question in VS Code (REQ-10.6):** right-click a private note outside `private/`, choose **Sync rule: Sync both ways** and confirm. In VS Code, the note reaches the repo, and the Project Docs view shows no "was private" item for it.
5. **Unloading leaves nothing behind:** disable the plugin. No status bar items, header icons, banners or decoded views remain.

## Follow-ups
- **The community store:** publishing the draft release and submitting the plugin to the store are TASK-31 of the main spec.
- **Pinned core:** the core is pinned to 0.1.0. Moving to a later core is a deliberate change, since `0.x` releases may change the API.
