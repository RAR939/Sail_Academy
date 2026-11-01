import type { ShoreStory } from "../network/ShoreApi";

export class ShoreHud {
  private readonly root = document.createElement("aside");
  private readonly title = document.createElement("h2");
  private readonly task = document.createElement("p");
  private readonly distance = document.createElement("p");
  private readonly counter = document.createElement("span");
  private readonly equipment = document.createElement("span");
  private readonly notice = document.createElement("div");
  private timer: number | undefined;
  private story: ShoreStory | null = null;

  public constructor() {
    this.root.className = "shore-hud";
    this.root.hidden = true;
    const brand = document.createElement("div");
    brand.className = "shore-eyebrow";
    brand.textContent = "SAIL ACADEMY / БЕРЕГОВОЙ КЛУБ";
    this.counter.className = "shore-counter";
    this.equipment.className = "shore-equipment";
    this.distance.className = "shore-distance";
    const help = document.createElement("p");
    help.className = "shore-help";
    help.textContent = "WASD — идти · Shift — бег · E — взаимодействовать\nПКМ + мышь — камера · Колесо — масштаб";
    this.notice.className = "shore-notice";
    this.notice.hidden = true;
    this.notice.setAttribute("role", "status");
    this.root.append(brand, this.counter, this.title, this.task, this.distance, this.equipment, help);
    document.body.append(this.root, this.notice);
  }

  public setStory(story: ShoreStory): void {
    this.story = story;
    this.title.textContent = story.title;
    this.task.textContent = story.description;
    this.counter.textContent = story.completed ? "ИНСТРУКТАЖ ПРОЙДЕН" : `ПЕРВЫЙ ДЕНЬ · ${story.index + 1} / ${story.total}`;
    this.equipment.textContent = story.has_vest ? "● Спасательный жилет надет" : "○ Спасательный жилет ещё не получен";
    this.root.hidden = false;
  }

  public setVisible(visible: boolean): void {
    this.root.hidden = !visible || !this.story;
    if (!visible) this.notice.hidden = true;
  }

  public update(x: number, z: number): void {
    if (!this.story) return;
    const { position, completed } = this.story;
    this.distance.textContent = completed ? "Задавайте наставникам вопросы о парусном спорте" : `До цели: ${Math.round(Math.hypot(position.x - x, position.z - z))} м · ищите золотой маяк`;
  }

  public toast(text: string): void {
    window.clearTimeout(this.timer);
    this.notice.textContent = text;
    this.notice.hidden = false;
    this.timer = window.setTimeout(() => { this.notice.hidden = true; }, 6500);
  }

  public dispose(): void {
    window.clearTimeout(this.timer);
    this.root.remove();
    this.notice.remove();
  }
}
