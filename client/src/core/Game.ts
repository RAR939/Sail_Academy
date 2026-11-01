import {
  Color4,
  Engine,
  Scene,
} from "@babylonjs/core";
import { HubScene } from "../scenes/HubScene";
import { RaceScene } from "../scenes/RaceScene";
import { DEFAULT_WORLD, fetchWorld, type WorldConfig, type WorldResponse } from "../world/WorldConfig";


import { NetworkClient } from "../network/NetworkClient";
import { PlayerChat } from "../ui/PlayerChat";
import {
  NetworkLoginOverlay,
  type NetworkLoginValues,
} from "../ui/NetworkLoginOverlay";

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly network = new NetworkClient();
  private readonly playerChat: PlayerChat;
  private hubScene: HubScene;
  private revision = "";
  private world: WorldConfig = DEFAULT_WORLD;
  private connection: { baseUrl: string; token: string; skin: string } | null = null;
  private worldTimer: number | null = null;
  private changingWorld = false;
  private readonly adminButton = document.createElement("button");
  private readonly adminOverlay = document.createElement("div");
  private readonly adminFrame = document.createElement("iframe");
  private metricFrames = 0;
  private metricStart = performance.now();
  private readonly loginOverlay: NetworkLoginOverlay;
  private hasConnectedOnce = false;
  private unsubscribeNetworkStatus: (() => void) | null = null;
  private readonly gameSubscriptions: Array<() => void> = [];
  private raceScene: RaceScene | null = null;
  private userId: number | null = null;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.74, 0.94, 1);
    this.scene.collisionsEnabled = true;

    this.hubScene = new HubScene(this.scene, canvas, this.network, this.world);
    this.playerChat = new PlayerChat(this.network, canvas);
    this.adminButton.textContent = "⚙ Админ-панель";
    this.adminButton.className = "admin-entry";
    this.adminButton.hidden = true;
    this.adminOverlay.className = "admin-overlay"; this.adminOverlay.hidden = true;
    const adminClose = document.createElement("button"); adminClose.className = "admin-close"; adminClose.textContent = "Закрыть ×";
    adminClose.addEventListener("click", () => this.closeAdmin());
    this.adminFrame.title = "Админ-панель";
    this.adminOverlay.append(adminClose, this.adminFrame); document.body.append(this.adminOverlay);
    this.adminButton.addEventListener("click", () => {
      const connection = this.connection; if (!connection) return;
      const url = new URL("/admin.html", connection.baseUrl);
      this.adminFrame.onload = () => this.adminFrame.contentWindow?.postMessage({ type: "sail-admin-auth", token: connection.token }, url.origin);
      this.adminFrame.src = url.toString(); this.adminOverlay.hidden = false;
      this.hubScene.setActive(false); document.exitPointerLock?.();
    });
    document.body.append(this.adminButton);
    this.loginOverlay = new NetworkLoginOverlay(this.authenticate);
    this.loginOverlay.show();

    this.gameSubscriptions.push(
      this.network.on("welcome", (message) => { this.userId = message.user_id; }),
      this.network.on("location_changed", (message) => {
        if (message.roomType === "race" && this.userId !== null) {
          this.raceScene?.dispose();
          this.hubScene.setActive(false);
          this.raceScene = new RaceScene(this.engine, this.canvas, this.network, this.userId);
        } else if (message.roomType === "hub") {
          this.raceScene?.dispose();
          this.raceScene = null;
          this.hubScene.setActive(true);
        }
      }),
    );


    this.unsubscribeNetworkStatus = this.network.onStatus((status) => {
      if (status === "connected") {
        this.hasConnectedOnce = true;
        console.info("[NetworkClient] Подключено к Sail Academy");
        return;
      }

      if (status === "disconnected") {
        this.raceScene?.dispose();
        this.raceScene = null;
        this.hubScene.setActive(true);
        this.adminButton.hidden = true;
        this.closeAdmin();
        this.connection = null;
        if (this.hasConnectedOnce) this.loginOverlay.show();
      }
    });
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;
      this.metricFrames++;
      const now = performance.now();
      if (now - this.metricStart >= 5000) {
        if (this.network.isConnected) this.network.sendMetrics(this.metricFrames * 1000 / (now - this.metricStart));
        this.metricFrames = 0; this.metricStart = now;
      }

      if (this.raceScene) this.raceScene.update(deltaSeconds);
      else { this.hubScene.update(deltaSeconds); this.scene.render(); }
    });

    window.addEventListener("resize", this.resize);
    this.worldTimer = window.setInterval(() => { void this.refreshWorld(); if (this.connection) void this.checkAdmin(this.connection.baseUrl, this.connection.token); }, 3000);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resize);
    if (this.worldTimer !== null) window.clearInterval(this.worldTimer);
    this.adminButton.remove();
    this.adminOverlay.remove();
    this.unsubscribeNetworkStatus?.();
    this.gameSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.raceScene?.dispose();
    this.loginOverlay.dispose();
    this.playerChat.dispose();
    this.network.disconnect();
    this.hubScene.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

private readonly authenticate = async (
  values: NetworkLoginValues
): Promise<void> => {
  const baseUrl = values.serverUrl.replace(/\/+$/, "");
  const serverUrl = new URL(baseUrl);
  if (!["http:", "https:"].includes(serverUrl.protocol)) {
    throw new Error("Адрес сервера должен начинаться с http:// или https://");
  }
  if (window.location.protocol === "https:" && serverUrl.protocol !== "https:") {
    throw new Error("Игра открыта по HTTPS. Укажите адрес сервера, начинающийся с https://");
  }

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
    if (!connection || !this.adminOverlay.hidden || this.raceScene || this.changingWorld || !this.network.isConnected || !this.hubScene.canApplyWorld) return;
    this.changingWorld = true;
    try {
      const published = await fetchWorld(connection.baseUrl);
      if (this.connection !== connection || this.raceScene || !this.network.isConnected || !this.hubScene.canApplyWorld) return;
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

  private closeAdmin(): void {
    if (this.adminOverlay.hidden) return;
    this.adminOverlay.hidden = true; this.adminFrame.src = "about:blank";
    if (!this.raceScene) this.hubScene.setActive(true);
    this.canvas.focus();
  }

  private readonly resize = (): void => {
    this.engine.resize();
  };
}
