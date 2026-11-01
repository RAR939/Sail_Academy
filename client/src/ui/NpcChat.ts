import type { NpcReply } from "../network/ShoreApi";

export interface NpcIdentity { id: string; name: string; role: string; color: string }

export class NpcChat {
  private readonly root = document.createElement("section");
  private readonly heading = document.createElement("h2");
  private readonly role = document.createElement("p");
  private readonly history = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly input = document.createElement("input");
  private readonly send = document.createElement("button");
  private readonly suggestions = document.createElement("div");
  private controller: AbortController | null = null;
  private npc: NpcIdentity | null = null;
  private onClose: (() => void) | null = null;
  private pending = false;

  public get isOpen(): boolean { return !this.root.hidden; }

  public constructor(
    private readonly request: (id: string, text: string, signal: AbortSignal) => Promise<NpcReply>,
    private readonly onReply: (reply: NpcReply) => void,
  ) {
    this.root.className = "npc-chat";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Разговор с наставником");
    this.root.setAttribute("aria-modal", "true");
    const header = document.createElement("header");
    const close = document.createElement("button");
    close.textContent = "Закончить разговор ×";
    close.addEventListener("click", () => this.close());
    header.append(this.heading, close);
    this.history.className = "npc-history";
    this.history.setAttribute("role", "log");
    this.history.setAttribute("aria-live", "polite");
    this.status.className = "npc-status";
    this.status.setAttribute("role", "status");
    this.suggestions.className = "npc-suggestions";
    const form = document.createElement("form");
    this.input.placeholder = "Спросите о парусном спорте…";
    this.input.setAttribute("aria-label", "Вопрос наставнику");
    this.input.maxLength = 600;
    this.input.required = true;
    this.send.type = "submit";
    this.send.textContent = "Спросить →";
    form.append(this.input, this.send);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (text && !this.pending) { this.input.value = ""; void this.ask(text); }
    });
    this.root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") this.close();
      if (event.key === "Tab") {
        const controls = [...this.root.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    this.root.addEventListener("keyup", (event) => event.stopPropagation());
    this.root.append(header, this.role, this.history, this.status, this.suggestions, form);
    document.body.append(this.root);
  }

  public open(npc: NpcIdentity, onClose: () => void): void {
    if (this.isOpen) this.close();
    this.npc = npc;
    this.onClose = onClose;
    this.heading.textContent = npc.name;
    this.heading.style.color = npc.color;
    this.role.textContent = npc.role;
    this.history.replaceChildren();
    this.suggestions.replaceChildren();
    this.input.value = "";
    const questions: Record<string, string[]> = {
      captain: ["Что такое оверштаг?", "Для чего нужен шкот?"],
      weather: ["Что проверить перед выходом?", "Зачем нужен жилет?"],
      judge: ["Что такое правый галс?", "Кто должен уступать дорогу?"],
      sailor: ["Что такое швартов?", "Какие бывают команды на лодке?"],
    };
    for (const text of questions[npc.id] ?? []) {
      const button = document.createElement("button");
      button.textContent = text;
      button.addEventListener("click", () => { if (!this.pending) void this.ask(text); });
      this.suggestions.append(button);
    }
    this.root.hidden = false;
    this.root.querySelector<HTMLButtonElement>("button")?.focus();
    void this.ask("Здравствуйте! Проведите мой текущий инструктаж и подскажите, что делать дальше.");
  }

  public close(): void {
    this.controller?.abort();
    this.controller = null;
    this.pending = false;
    this.root.hidden = true;
    this.npc = null;
    const callback = this.onClose;
    this.onClose = null;
    callback?.();
  }

  public dispose(): void { this.close(); this.root.remove(); }

  private line(speaker: string, text: string): void {
    const item = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = `${speaker}: `;
    item.append(name, document.createTextNode(text));
    this.history.append(item);
    this.history.scrollTop = this.history.scrollHeight;
  }

  private async ask(text: string): Promise<void> {
    if (!this.npc || this.pending) return;
    const npc = this.npc;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = true;
    this.send.disabled = true;
    this.input.disabled = true;
    this.suggestions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    this.status.textContent = "Наставник думает…";
    this.line("Вы", text);
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const reply = await this.request(npc.id, text, controller.signal);
      if (this.controller !== controller) return;
      this.line(reply.speaker, reply.text);
      this.status.textContent = reply.backend === "ollama" ? "Локальный ИИ · Ollama" : "Учебные ответы · локальная модель недоступна";
      this.onReply(reply);
    } catch (error) {
      if (this.controller !== controller) return;
      this.status.textContent = controller.signal.aborted ? "Ответ занял слишком много времени. Попробуйте снова." : error instanceof Error ? error.message : "Не удалось получить ответ. Попробуйте снова.";
    } finally {
      window.clearTimeout(timeout);
      if (this.controller === controller) {
        this.pending = false;
        this.send.disabled = false;
        this.input.disabled = false;
        this.suggestions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
        this.input.focus();
      }
    }
  }
}
