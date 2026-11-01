/**
 * Типы текущего WebSocket-протокола Sail Academy.
 * Основаны на server/app/websocket/router.py и server/app/game/game_loop.py.
 * Не добавляйте сюда события, пока они не реализованы на сервере.
 */

export type PlayerAnimation = "idle" | "walk" | "run" | "interact" | string;

export interface PlayerStateMessage {
  id: number;
  username: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: PlayerAnimation;
  boat?: BoatStateMessage;
}

export interface BoatStateMessage {
  ownerId: number;
  pos: [number, number, number];
  heading: number;
  sailAngle: number;
  speed?: number;
}

export interface AuthMessage {
  t: "auth";
  token: string;
}

export interface PingMessage {
  t: "ping";
}

export interface MoveMessage {
  t: "move";
  x: number;
  y: number;
  z: number;
  ry: number;
  anim?: string;
}

/** Текущий сервер принимает heading и sailAngle, а не rudder/mainsheet. */
export interface BoatInputMessage {
  t: "boat";
  heading: number;
  sailAngle: number;
}

export interface CreateRaceMessage {
  t: "create_race";
}

export interface EnterLocationMessage {
  t: "enter_location";
  locationId: "club" | "training_area" | "race_track";
  roomId?: string;
}

export type ClientMessage =
  | AuthMessage
  | PingMessage
  | MoveMessage
  | BoatInputMessage
  | CreateRaceMessage
  | EnterLocationMessage;

export interface WelcomeMessage {
  t: "welcome";
  user_id: number;
  username: string;
  room: string;
  /** Начальный список пока не содержит вложенное состояние лодок. */
  players: PlayerStateMessage[];
}

export interface PlayersMessage {
  t: "players";
  /** В текущей реализации это полный снимок комнаты, а не sparse delta. */
  delta: PlayerStateMessage[];
}

export interface WindMessage {
  t: "wind";
  speed: number;
  direction: number;
}

export interface PongMessage {
  t: "pong";
}

export interface ErrorMessage {
  t: "error";
  message: string;
}

export interface LocationChangedMessage {
  t: "location_changed";
  roomId: string;
  roomType: "hub" | "training" | "race";
  locationId: string;
  players: PlayerStateMessage[];
}

export interface RaceCreatedMessage {
  t: "race_created";
  roomId: string;
}

export interface RaceStateMessage {
  t: "race_state";
  phase: "start" | "marks" | "finish" | "completed";
  nextMark: number;
  elapsed: number;
  marks: [number, number][];
  markRadius: number;
  startLine: [[number, number], [number, number]];
  finishLine: [[number, number], [number, number]];
  markSide: "port";
  roundingGate: [number, number] | null;
  markApproached: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | PlayersMessage
  | WindMessage
  | PongMessage
  | ErrorMessage
  | LocationChangedMessage
  | RaceCreatedMessage
  | RaceStateMessage;

export type ServerMessageType = ServerMessage["t"];

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface PlayerMovementSnapshot {
  x: number;
  y: number;
  z: number;
  /** В Babylon.js это rotation.y; на сервере поле называется ry. */
  ry: number;
  anim?: string;
}
