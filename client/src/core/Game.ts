import {
  Color4,
  Engine,
  Scene,
} from "@babylonjs/core";
import { HubScene } from "../scenes/HubScene";
import { DEFAULT_WORLD, fetchWorld, type WorldConfig, type WorldResponse } from "../world/WorldConfig";


import { NetworkClient } from "../network/NetworkClient";
import {
  NetworkLoginOverlay,
  type NetworkLoginValues,
} from "../ui/NetworkLoginOverlay";

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly network = new NetworkClient();
  private hubScene: HubScene;
  private revision = "";
  private world: WorldConfig = DEFAULT_WORLD;
  private connection: { baseUrl: string; token: string; skin: string } | null = null;
  private worldTimer: number | null = null;
  private changingWorld = false;
  private readonly adminButton = document.createElement("button");
  private readonly loginOverlay: NetworkLoginOverlay;
  private hasConnectedOnce = false;
  private unsubscribeNetworkStatus: (() => void) | null = null;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.74, 0.94, 1);
    this.scene.collisionsEnabled = true;

    this.hubScene = new HubScene(this.scene, canvas, this.network, this.world);
    this.adminButton.textContent = "⚙ Админ-панель";
    this.adminButton.className = "admin-entry";
    this.adminButton.hidden = true;
    this.adminButton.addEventListener("click", () => { if (this.connection) window.open(new URL("/admin.html", this.connection.baseUrl).toString(), "_blank"); });
    document.body.append(this.adminButton);
    this.loginOverlay = new NetworkLoginOverlay(this.authenticate);
    this.loginOverlay.show();


    this.unsubscribeNetworkStatus = this.network.onStatus((status) => {
      if (status === "connected") {
        this.hasConnectedOnce = true;
        console.info("[NetworkClient] Подключено к Sail Academy");
        return;
      }

      if (status === "disconnected") {
        this.adminButton.hidden = true;
        this.connection = null;
        if (this.hasConnectedOnce) this.loginOverlay.show();
      }
    });
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;

      this.hubScene.update(deltaSeconds);
      this.scene.render();
    });

    window.addEventListener("resize", this.resize);
    this.worldTimer = window.setInterval(() => { void this.refreshWorld(); }, 3000);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resize);
    if (this.worldTimer !== null) window.clearInterval(this.worldTimer);
    this.adminButton.remove();
    this.unsubscribeNetworkStatus?.();
    this.loginOverlay.dispose();
    this.network.disconnect();
    this.hubScene.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

private readonly authenticate = async (
  values: NetworkLoginValues
): Promise<void> => {
  const baseUrl = values.serverUrl.replace(/\/+$/, "");

  // Регистрация нового пользователя
  if (values.mode === "register") {
    const response = await fetch(
      `${baseUrl}/api/auth/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
          display_name: values.username,
        }),
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.detail || "Ошибка регистрации");
    }
  }

  // Получение JWT
  const login = await NetworkClient.login(baseUrl, {
    username: values.username,
    password: values.password,
  });

  // Сохранение токена на время вкладки
  sessionStorage.setItem(
    "sail_academy_access_token",
    login.access_token
  );

  const published = await fetchWorld(baseUrl);
  if (published.revision !== this.revision) this.replaceScene(published);

  // Подключение к игровому серверу
  const wsUrl = new URL("/ws/game", baseUrl);

  wsUrl.protocol =
    wsUrl.protocol === "https:" ? "wss:" : "ws:";

  // Метод connect ожидает welcome от сервера
  await this.network.connect(
    wsUrl.toString(),
    login.access_token,
    values.skin
  );
  try {
    await this.hubScene.enter(baseUrl, login.access_token, values.skin);
  } catch (error) {
    this.network.disconnect();
    throw error;
  }
  this.connection = { baseUrl, token: login.access_token, skin: values.skin };
  void this.checkAdmin(baseUrl, login.access_token);
  this.loginOverlay.hide();
};

  private replaceScene(published: WorldResponse): void {
    const previous = this.hubScene.captureSession();
    this.hubScene.dispose();
    this.world = published.world;
    this.revision = published.revision;
    this.hubScene = new HubScene(this.scene, this.canvas, this.network, this.world);
    this.hubScene.restoreSession(previous);
  }

  private async refreshWorld(): Promise<void> {
    const connection = this.connection;
    if (!connection || this.changingWorld || !this.network.isConnected || !this.hubScene.canApplyWorld) return;
    this.changingWorld = true;
    try {
      const published = await fetchWorld(connection.baseUrl);
      if (this.connection !== connection || !this.network.isConnected || !this.hubScene.canApplyWorld) return;
      if (published.revision !== this.revision) {
        this.replaceScene(published);
        await this.hubScene.enter(connection.baseUrl, connection.token, connection.skin);
      }
    } catch (error) {
      // Retry if applying the new scene failed after its revision was accepted.
      if (this.connection === connection && this.network.isConnected) this.revision = "";
      console.warn("Не удалось обновить мир", error);
    } finally { this.changingWorld = false; }
  }

  private async checkAdmin(baseUrl: string, token: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/api/admin/world`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (this.connection?.token === token) this.adminButton.hidden = !response.ok;
    } catch { this.adminButton.hidden = true; }
  }

  private readonly resize = (): void => {
    this.engine.resize();
  };
}
