import type { ChatMessage } from "../network/NetworkMessages";
import type { NetworkClient } from "../network/NetworkClient";

/** Room chat stays available across hub and race scenes. */
export class PlayerChat {
  private readonly root = document.createElement("aside");
  private readonly toggle = document.createElement("button");
  private readonly panel = document.createElement("section");
  private readonly history = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly input = document.createElement("input");
  private readonly send = document.createElement("button");
  private readonly unsubscribers: Array<() => void> = [];
  private readonly network: NetworkClient;
  private readonly canvas: HTMLCanvasElement;
  private roomId: string | null = null;
  private unread = 0;
  private userId: number | null = null;

  public constructor(network: NetworkClient, canvas: HTMLCanvasElement) {
    this.network = network;
    this.canvas = canvas;
    this.root.className = "player-chat";
    this.root.hidden = true;
    this.toggle.type = "button";
    this.toggle.textContent = "Чат игроков";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-controls", "player-chat-panel");
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.hidden !== false));
    this.panel.id = "player-chat-panel";
    this.panel.className = "player-chat-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Чат игроков в комнате");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "Чат комнаты";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Свернуть ×";
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, close);
    this.history.className = "player-chat-history";
    this.history.setAttribute("role", "log");
    this.history.setAttribute("aria-live", "polite");
    this.status.className = "player-chat-status";
    this.status.setAttribute("role", "status");
    const form = document.createElement("form");
    this.input.type = "text";
    this.input.maxLength = 400;
    this.input.required = true;
    this.input.placeholder = "Написать игрокам…";
    this.input.setAttribute("aria-label", "Сообщение игрокам в комнате");
    this.send.type = "submit";
    this.send.textContent = "Отправить";
    form.append(this.input, this.send);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      try {
        this.network.sendChat(text);
        this.input.value = "";
        this.status.textContent = "";
      } catch {
        this.status.textContent = "Нет соединения с сервером.";
      }
    });
    this.root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !this.panel.hidden) { event.preventDefault(); this.setOpen(false); }
    });
    this.root.addEventListener("keyup", (event) => event.stopPropagation());
    this.panel.append(header, this.history, this.status, form);
    this.root.append(this.panel, this.toggle);
    document.body.append(this.root);
    this.unsubscribers.push(
      network.on("welcome", (message) => { this.userId = message.user_id; this.setRoom(message.room); }),
      network.on("location_changed", (message) => this.setRoom(message.roomId)),
      network.on("chat", (message) => this.receive(message)),
      network.on("chat_error", (message) => { this.status.textContent = message.message; }),
      network.onStatus((state) => {
        this.root.hidden = state !== "connected";
        if (state === "disconnected") {
          this.setOpen(false, false);
          this.setRoom(null);
          this.userId = null;
          this.status.textContent = "";
          this.input.value = "";
        }
      }),
    );
  }

  private setRoom(roomId: string | null): void {
    if (this.roomId === roomId) return;
    this.roomId = roomId;
    this.history.replaceChildren();
    this.input.value = "";
    this.status.textContent = "Сообщения видны игрокам в этой комнате.";
    this.unread = 0;
    this.updateToggle();
  }

  private receive(message: ChatMessage): void {
    if (message.roomId !== this.roomId) return;
    const line = document.createElement("p");
    const author = document.createElement("strong");
    author.textContent = `${message.username}: `;
    line.append(author, document.createTextNode(message.text));
    this.history.append(line);
    while (this.history.childElementCount > 100) this.history.firstElementChild?.remove();
    this.history.scrollTop = this.history.scrollHeight;
    if (this.panel.hidden && message.user_id !== this.userId) {
      this.unread = Math.min(this.unread + 1, 99);
      this.updateToggle();
    }
  }

  private setOpen(open: boolean, restoreFocus = true): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      document.exitPointerLock?.();
      this.unread = 0;
      this.updateToggle();
      this.input.focus();
    } else if (restoreFocus) this.canvas.focus();
  }

  private updateToggle(): void {
    this.toggle.textContent = this.unread ? `Чат игроков · ${this.unread}` : "Чат игроков";
  }

  public dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.root.remove();
  }
}
