/**
 * The question asked before a private note is made syncable (REQ-9.0.4, 9.3): it names the note
 * and says where in the repo it will be copied, since that is the one rule change that sends
 * content to the repo.
 */
import { Modal, Setting, type App, type ButtonComponent } from "obsidian";

/**
 * Styles a button as one that does something hard to undo, with the class Obsidian itself uses.
 * `setDestructive` needs Obsidian 1.13, and `setWarning`, which the plugin's 1.8.7 minimum has,
 * is deprecated.
 */
function markDestructive(button: ButtonComponent): void {
  button.buttonEl.addClass("mod-warning");
}

/** Asks whether a private note may sync. Resolves true only if the user chooses to. */
export class ConfirmUnprivateModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly repoPath: string | null,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Sync this note to the repo?");
    const where = this.repoPath ? ` as ${this.repoPath}` : "";
    this.contentEl.createEl("p", {
      text: `${this.noteName} is private. Syncing it copies it into the repo${where}, where it can be committed and pushed.`,
    });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Sync to repo").onClick(() => this.answer(true));
        markDestructive(button);
      })
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.answer(false)));
  }

  override onClose(): void {
    // Closing the dialog any other way, such as with Escape, is a no.
    this.answer(false);
  }

  private answer(confirmed: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.resolve(confirmed);
    this.close();
  }
}

/** Asks the question, and resolves with the answer. */
export function confirmUnprivate(
  app: App,
  noteName: string,
  repoPath: string | null,
): Promise<boolean> {
  return new Promise((resolve) =>
    new ConfirmUnprivateModal(app, noteName, repoPath, resolve).open(),
  );
}
