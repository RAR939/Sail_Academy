export interface DialogueLine {
  speaker: string;
  text: string;
  portraitLetter: string;
  portraitColor: string;
}

export class DialogueOverlay {
  public get isOpen(): boolean {
    return !this.root.hidden;
  }

  private readonly root: HTMLElement;
  private readonly portrait: HTMLDivElement;
  private readonly speaker: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;

  private lines: DialogueLine[] = [];
  private currentLineIndex = 0;
  private onClose: (() => void) | null = null;

  public constructor() {
    this.root = document.createElement("section");
    this.root.className = "dialogue-overlay";
    this.root.hidden = true;
    this.root.setAttribute("aria-live", "polite");
    this.root.setAttribute("aria-label", "Диалог с персонажем");

    this.portrait = document.createElement("div");
    this.portrait.className = "dialogue-portrait";

    const content = document.createElement("div");
    content.className = "dialogue-content";

    this.speaker = document.createElement("div");
    this.speaker.className = "dialogue-speaker";

    this.text = document.createElement("p");
    this.text.className = "dialogue-text";

    const actions = document.createElement("div");
    actions.className = "dialogue-actions";

    this.nextButton = document.createElement("button");
    this.nextButton.className = "dialogue-button dialogue-button-primary";
    this.nextButton.type = "button";
    this.nextButton.textContent = "Дальше";
    this.nextButton.addEventListener("click", () => this.advance());

    this.exitButton = document.createElement("button");
    this.exitButton.className = "dialogue-button";
    this.exitButton.type = "button";
    this.exitButton.textContent = "Выйти";
    this.exitButton.addEventListener("click", () => this.close());

    actions.append(this.nextButton, this.exitButton);
    content.append(this.speaker, this.text, actions);
    this.root.append(this.portrait, content);
    document.body.append(this.root);
  }

  public open(
    lines: readonly DialogueLine[],
    onClose: (() => void) | null = null,
  ): void {
    this.lines = [...lines];
    this.currentLineIndex = 0;
    this.onClose = onClose;

    if (this.lines.length === 0) {
      this.close();
      return;
    }

    this.root.hidden = false;
    this.renderCurrentLine();
    this.nextButton.focus();
  }

  public close(): void {
    if (this.root.hidden) {
      return;
    }

    this.root.hidden = true;

    const callback = this.onClose;
    this.onClose = null;
    callback?.();
  }

  public dispose(): void {
    this.close();
    this.root.remove();
  }

  private advance(): void {
    if (this.currentLineIndex >= this.lines.length - 1) {
      return;
    }

    this.currentLineIndex += 1;
    this.renderCurrentLine();
  }

  private renderCurrentLine(): void {
    const line = this.lines[this.currentLineIndex];

    if (!line) {
      this.close();
      return;
    }

    this.speaker.textContent = line.speaker;
    this.text.textContent = line.text;
    this.portrait.textContent = line.portraitLetter;
    this.portrait.style.background = line.portraitColor;

    this.nextButton.hidden =
      this.currentLineIndex >= this.lines.length - 1;
  }
}