export interface ShoreStory {
  step: string;
  index: number;
  total: number;
  title: string;
  description: string;
  target: string | null;
  position: { x: number; z: number };
  has_vest: boolean;
  completed: boolean;
}

export interface NpcReply {
  npc_id: string;
  speaker: string;
  text: string;
  backend: "ollama" | "fallback";
  story: ShoreStory;
}

export class ShoreApi {
  private baseUrl = "";
  private token = "";

  public configure(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  public story(): Promise<ShoreStory> {
    return this.request("/api/story");
  }

  public dialog(npcId: string, text: string, signal: AbortSignal): Promise<NpcReply> {
    return this.request("/api/ai/dialog", { npc_id: npcId, text }, signal);
  }

  public interact(target: string): Promise<{ text: string; story: ShoreStory }> {
    return this.request("/api/story/interact", { target });
  }

  private async request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { detail?: unknown };
      throw new Error(typeof data.detail === "string" ? data.detail : `Ошибка сервера (${response.status})`);
    }
    return response.json() as Promise<T>;
  }
}
