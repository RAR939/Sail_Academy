import {
  Color4,
  Engine,
  Scene,
} from "@babylonjs/core";
import { HubScene } from "../scenes/HubScene";
import { RaceScene } from "../scenes/RaceScene";


import { NetworkClient } from "../network/NetworkClient";
import {
  NetworkLoginOverlay,
  type NetworkLoginValues,
} from "../ui/NetworkLoginOverlay";

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly network = new NetworkClient();
  private readonly hubScene: HubScene;
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

    this.hubScene = new HubScene(this.scene, canvas, this.network);
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

      if (status === "disconnected" && this.hasConnectedOnce) {
        this.raceScene?.dispose();
        this.raceScene = null;
        this.hubScene.setActive(true);
        this.loginOverlay.show();
      }
    });
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;

      if (this.raceScene) this.raceScene.update(deltaSeconds);
      else { this.hubScene.update(deltaSeconds); this.scene.render(); }
    });

    window.addEventListener("resize", this.resize);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.unsubscribeNetworkStatus?.();
    this.gameSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.raceScene?.dispose();
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

  // Подключение к игровому серверу
  const wsUrl = new URL("/ws/game", baseUrl);

  wsUrl.protocol =
    wsUrl.protocol === "https:" ? "wss:" : "ws:";

  // Метод connect ожидает welcome от сервера
  await this.network.connect(
    wsUrl.toString(),
    login.access_token
  );
  try {
    await this.hubScene.enter(baseUrl, login.access_token);
  } catch (error) {
    this.network.disconnect();
    throw error;
  }
  this.loginOverlay.hide();
};

  private readonly resize = (): void => {
    this.engine.resize();
  };
}
