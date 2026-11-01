import type {
  BoatInputMessage,
  ClientMessage,
  EnterLocationMessage,
  LoginCredentials,
  LoginResponse,
  MoveMessage,
  PlayerMovementSnapshot,
  ServerMessage,
  ServerMessageType,
  WelcomeMessage,
} from "./NetworkMessages";

export type NetworkStatus = "disconnected" | "connecting" | "connected";

type MessageOf<T extends ServerMessageType> = Extract<ServerMessage, { t: T }>;
type MessageListener<T extends ServerMessageType> = (message: MessageOf<T>) => void;
type StatusListener = (status: NetworkStatus) => void;

export interface NetworkClientOptions {
  /** Интервал keep-alive. Передайте 0, чтобы отключить ping. */
  pingIntervalMs?: number;
  /** Таймаут ожидания welcome после отправки auth. */
  welcomeTimeoutMs?: number;
}

/**
 * WebSocket-клиент для текущего backend Sail Academy.
 * Авторизация — первым JSON-сообщением после открытия WebSocket.
 */
export class NetworkClient {
  private raceHistoryUrl = "";
  private raceHistoryToken = "";
  public async raceHistory(): Promise<Array<{ name: string; startedAt: string | null; players: Array<{ name: string; place: number | null; elapsed: number | null }> }>> {
    const response = await fetch(this.raceHistoryUrl, { headers: { Authorization: `Bearer ${this.raceHistoryToken}` } });
    if (!response.ok) throw new Error("Не удалось загрузить историю гонок");
    return response.json();
  }
  private socket: WebSocket | null = null;
  private status: NetworkStatus = "disconnected";
  private pingTimer: number | null = null;
  private pingSentAt: number | null = null;
  public pingMs: number | null = null;
  private welcomeTimer: number | null = null;
  private readonly listeners = new Map<ServerMessageType, Set<(message: never) => void>>();
  private readonly statusListeners = new Set<StatusListener>();
  private pendingWelcome: {
    resolve: (message: WelcomeMessage) => void;
    reject: (error: Error) => void;
  } | null = null;

  private readonly pingIntervalMs: number;
  private readonly welcomeTimeoutMs: number;

  public constructor(options: NetworkClientOptions = {}) {
    this.pingIntervalMs = options.pingIntervalMs ?? 10_000;
    this.welcomeTimeoutMs = options.welcomeTimeoutMs ?? 8_000;
  }

  public get connectionStatus(): NetworkStatus {
    return this.status;
  }

  public get isConnected(): boolean {
    return this.status === "connected" && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Выполняет HTTP-авторизацию через POST /api/auth/login.
   * baseHttpUrl, например: http://192.168.1.100:8000
   */
  public static async login(
    baseHttpUrl: string,
    credentials: LoginCredentials,
  ): Promise<LoginResponse> {
    const response = await fetch(`${baseHttpUrl.replace(/\/$/, "")}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      let detail = `Ошибка авторизации (${response.status})`;

      try {
        const body = (await response.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // Ответ может быть не JSON; оставляем сообщение со статусом.
      }

      throw new Error(detail);
    }

    return (await response.json()) as LoginResponse;
  }

  /** Подключается к WebSocket и разрешается после получения welcome. */
  public connect(url: string, token: string, skin = "skaterMaleA"): Promise<WelcomeMessage> {
    if (this.status !== "disconnected") {
      return Promise.reject(new Error("WebSocket уже подключён или подключается"));
    }

    if (!token.trim()) {
      return Promise.reject(new Error("JWT access token не задан"));
    }

    const endpoint = new URL(url); endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:"; endpoint.pathname = "/api/races/history"; endpoint.search = "";
    this.raceHistoryUrl = endpoint.toString(); this.raceHistoryToken = token;

    this.setStatus("connecting");

    return new Promise<WelcomeMessage>((resolve, reject) => {
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        this.clearWelcomeTimer();
        this.pendingWelcome = null;
        reject(error);
      };

      this.pendingWelcome = {
        resolve: (message) => {
          if (settled) return;
          settled = true;
          this.clearWelcomeTimer();
          this.pendingWelcome = null;
          resolve(message);
        },
        reject: fail,
      };

      let socket: WebSocket;

      try {
        socket = new WebSocket(url);
      } catch (error) {
        this.setStatus("disconnected");
        fail(error instanceof Error ? error : new Error("Не удалось создать WebSocket"));
        return;
      }

      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;

        this.sendRaw({ t: "auth", token, skin });
        this.welcomeTimer = window.setTimeout(() => {
          fail(new Error("Сервер не прислал welcome после авторизации"));
          socket.close(4000, "Welcome timeout");
        }, this.welcomeTimeoutMs);
      });

      socket.addEventListener("message", (event: MessageEvent<string>) => {
        if (this.socket !== socket) return;

        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          this.emitError(new Error("Сервер прислал некорректный JSON"));
          return;
        }

        if (!message || typeof message !== "object" || typeof message.t !== "string") {
          this.emitError(new Error("Сервер прислал сообщение неизвестного формата"));
          return;
        }
        if (message.t === "pong" && this.pingSentAt !== null) { this.pingMs = Math.min(60000, performance.now() - this.pingSentAt); this.pingSentAt = null; }

        if (message.t === "welcome") {
          this.setStatus("connected");
          this.startPing();
          this.pendingWelcome?.resolve(message);
        } else if (message.t === "error") {
          this.emit("error", message);
        }

        this.emit(message.t, message as ServerMessage);
      });

      socket.addEventListener("error", () => {
        const error = new Error("Ошибка WebSocket-соединения");
        this.pendingWelcome?.reject(error);
        this.emitError(error);
      });

      socket.addEventListener("close", (event: CloseEvent) => {
        if (this.socket !== socket) return;

        this.stopPing();
        this.clearWelcomeTimer();
        this.socket = null;
        this.setStatus("disconnected");
        this.pendingWelcome?.reject(
          new Error(`WebSocket закрыт (${event.code}): ${event.reason || "без причины"}`),
        );
      });
    });
  }

  public sendMovement(snapshot: PlayerMovementSnapshot): void {
    const message: MoveMessage = {
      t: "move",
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
      ry: snapshot.ry,
      ...(snapshot.anim === undefined ? {} : { anim: snapshot.anim }),
    };
    this.send(message);
  }

  public sendBoatInput(heading: number, sailAngle: number): void {
    const message: BoatInputMessage = {
      t: "boat",
      heading,
      sailAngle,
    };
    this.send(message);
  }

  public enterLocation(
    locationId: EnterLocationMessage["locationId"],
    roomId?: string,
  ): void {
    const message: EnterLocationMessage = {
      t: "enter_location",
      locationId,
      ...(roomId === undefined ? {} : { roomId }),
    };
    this.send(message);
  }

  public createRace(): void {
    this.send({ t: "create_race" });
  }

  public startRace(): void { this.send({ t: "start_race" }); }

  public ping(): void {
    this.pingSentAt = performance.now();
    this.send({ t: "ping" });
  }

  public sendMetrics(fps: number): void { this.send({ t: "metrics", fps: Math.min(1000, Math.max(0, fps)), ping: this.pingMs }); }

  public on<T extends ServerMessageType>(
    type: T,
    listener: MessageListener<T>,
  ): () => void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }

    bucket.add(listener as (message: never) => void);
    return () => bucket?.delete(listener as (message: never) => void);
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public disconnect(code = 1000, reason = "Client disconnect"): void {
    this.pingMs = null; this.pingSentAt = null;
    this.stopPing();
    this.clearWelcomeTimer();

    const socket = this.socket;
    this.socket = null;

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(code, reason);
    }

    this.setStatus("disconnected");
    this.pendingWelcome?.reject(new Error("Подключение закрыто клиентом"));
    this.pendingWelcome = null;
  }

  private send(message: ClientMessage): void {
    if (!this.isConnected) {
      throw new Error("Нельзя отправить сообщение: WebSocket не подключён");
    }
    this.sendRaw(message);
  }

  private sendRaw(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket ещё не открыт");
    }
    this.socket.send(JSON.stringify(message));
  }

  private emit<T extends ServerMessageType>(type: T, message: ServerMessage): void {
    const bucket = this.listeners.get(type);
    if (!bucket) return;

    for (const listener of bucket) {
      listener(message as never);
    }
  }

  private emitError(error: Error): void {
    console.error("[NetworkClient]", error);
  }

  private setStatus(status: NetworkStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private startPing(): void {
    this.stopPing();
    if (this.pingIntervalMs <= 0) return;

    this.pingTimer = window.setInterval(() => {
      if (this.isConnected) this.ping();
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearWelcomeTimer(): void {
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
  }
}
