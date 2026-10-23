# Decoded-view prototype (TASK-3)

The question design decision 14 leaves open: can Obsidian's reading view show a note decoded, section by section, completely enough to be the default? Or does the separate read-only view, which renders the whole decoded note at once, become the default?

**Result:** reading view fails the completeness check on ordinary notes (footnotes and properties), and in one case it fails silently. By decision 14's own rule, the separate view becomes the default. Changing REQ-14.0.2's "in reading view" needs your agreement.

## How it was measured

- **Code:** `src/decode/reading.ts`, with `src/decode/sections.ts`.
  - A Markdown post-processor takes each rendered section's source lines (`getSectionInfo`), drops lines inside public-only blocks (matched against the whole note), restores the rest with the core, and renders the section again from the decoded source.
  - The completeness check looks at the view's whole rendered text. It requires that no mapped placeholder remains, under the standard's boundary rule, and that every section on the page had source lines.
- **Comparison:** the same note's whole source, decoded and rendered at once (`wholeText`), as the separate view would show it.
- **Notes:** ten test notes in `test/e2e/vault/prototype/`. The mapping uses the standard's fake values.
- **Measurements:** `test/e2e/prototype/reading-view.e2e.ts`, run with `PROTOTYPE=1 npm run test:e2e`, in real Obsidian 1.8.7 (installer 1.5.8, the manifest's minimum) and 1.14.4, on Windows. The raw results are in `test/e2e/out/`, which isn't committed.

## Results

Both versions gave the same results, except for footnotes.

| Note | What it has | Reading view, section by section | Whole note at once |
|---|---|---|---|
| `paragraphs` | Headings, lists, nesting, a quote, bold, a link with a placeholder in its text and its URL, `notmyhost` | Complete, same text as the whole note | Complete |
| `callouts` | Callouts with placeholders in titles and bodies, folded, nested | Complete, same | Complete |
| `tables` | Placeholders in cells, aligned columns, inline code in a cell | Complete, same | Complete |
| `code` | Inline code, a fenced block, an indented block, a tilde fence | Complete, same | Complete |
| `public-only` | A public-only block spanning two paragraphs | Complete, same | Complete |
| `boundaries` | `notmyhost`, `myhost-dev`, `100.64.0.1` beside `100.64.0.10` | Complete, same | Complete |
| `long` | 300 paragraphs, past what reading view renders at once | Complete, also after scrolling to the end | Complete |
| `footnotes` | Two references and their definitions | **Wrong.** See below | Complete |
| `properties` | A placeholder in a frontmatter property | **Coded:** the properties panel shows `myhost` | Complete. The frontmatter shows as text, decoded |
| `embeds` | Embeds of a whole coded note and of one section of another | **Coded** | **Coded:** embedded sections have no source lines |

### What goes wrong

- **Footnotes.** A footnote's rendering depends on the whole note, and decoding a section on its own breaks it.
  - **On 1.14.4:** Obsidian renders the footnote definitions as a block of its own that no post-processor sees, so the definitions stay coded. The check catches this.
  - **On 1.8.7:** the definitions disappear altogether, and the references show their labels instead of numbers. The check reports **complete**, because nothing coded is on the page. Information is lost, and nothing says so. That's a blind spot in the check itself.
- **Properties.** The properties panel isn't rendered from Markdown, so no post-processor reaches it. It's also editable in reading view. Putting real values into it would risk them being saved into the note, so it can't be decoded in place.
- **Embeds.** Obsidian renders an embedded note from that note's own coded file, and its sections come with no source lines. Neither approach decodes them as they stand. When the plugin renders the page itself, it can render each embedded note decoded instead, since it controls that rendering.

## Recommendation

1. **Make the separate read-only view the default.** It renders the whole decoded note, so footnotes, frontmatter and everything else Obsidian renders from Markdown come out right.
   - **Opening it:** it opens from the note's header toggle, in the same tab, and the toggle switches back to the note.
   - **Embedded notes:** shown decoded, rendered by the plugin from their own files with the same mapping.
   - **Before anything is shown:** the completeness check still runs on the whole view. Any placeholder left, or an embed that couldn't be decoded, shows the error instead of the page.
2. **Don't ship reading-view decoding, even as an option.**
   - It needs a workaround each for footnotes, properties and embeds.
   - Its behavior already differs between 1.8.7 and 1.14.4.
   - Its check can pass while content is missing.
3. **Changes needed in the main spec:**
   - **REQ-14.0.2:** in Obsidian, "in reading view" becomes "in a read-only decoded view opened from the note's header".
   - **AC 14.3:** "Toggling decoded in Obsidian reading view" becomes "Toggling decoded in Obsidian".
   - **Design decision 14:** records this result.

The section-by-section code stays only as the prototype's record. If the separate view is approved, TASK-11 replaces it with the separate view, and keeps `sections.ts`'s public-only handling and `remainingPlaceholders` for the check.
