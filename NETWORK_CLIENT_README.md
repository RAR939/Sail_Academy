# Network layer — first implementation

Replace the corresponding files in `client/src/network/` with the two files from this patch.

## Current scope

- Typed client/server message contracts matching the current FastAPI backend.
- HTTP login helper for `POST /api/auth/login`.
- WebSocket connection to `/ws/game`.
- Sends `{ "t": "auth", "token": "..." }` as the first frame after socket open.
- Resolves `connect()` only after receiving `welcome`.
- Typed subscriptions for server messages and connection status.
- Movement, boat input, location transition, race creation, and ping helpers.
- Periodic ping and clean disconnect.

Automatic reconnect is intentionally not implemented yet. The current backend creates a fresh in-memory player state on a new authenticated connection, so reconnect behavior should be designed together with backend state-preservation changes.

## Minimal usage

```ts
import { NetworkClient } from "./network/NetworkClient";

const network = new NetworkClient();

const login = await NetworkClient.login("http://127.0.0.1:8000", {
  username: "demo",
  password: "your-password",
});

const welcome = await network.connect(
  "ws://127.0.0.1:8000/ws/game",
  login.access_token,
);

console.log("Connected as", welcome.username, "in", welcome.room);

network.on("players", (message) => {
  console.log("Room snapshot", message.delta);
});

network.on("wind", (message) => {
  console.log("Wind", message.speed, message.direction);
});

network.on("error", (message) => {
  console.error("Server error", message.message);
});

network.onStatus((status) => {
  console.log("Network status:", status);
});

// Call from the game update loop at a controlled rate, not every render frame.
network.sendMovement({
  x: 1,
  y: 0,
  z: 2,
  ry: 0.5,
  anim: "walk",
});

// When leaving the game:
network.disconnect();
```

## LAN configuration

For another computer, replace `127.0.0.1` with the server computer's LAN IP, e.g.:

- HTTP: `http://192.168.1.100:8000`
- WebSocket: `ws://192.168.1.100:8000/ws/game`

The FastAPI server must listen on `0.0.0.0` and the firewall must allow inbound TCP port `8000`. Do not expose this unauthenticated development server to the public internet.

## Important current backend constraints

- The message discriminator is `t`.
- `players.delta` is currently a full room snapshot, not a sparse delta.
- `welcome.players` does not currently contain nested boat state.
- Boat input is `{ t: "boat", heading, sailAngle }`; do not send `rudder`/`mainsheet` or client position.
- There is no `player_left` event yet.
- Movement is validated against server speed limits. The current client run speed (6.2) is above the backend's 4.0 units/sec limit; sprint movement may be rejected until both sides agree on movement speed and validation.
- The current client has no login screen. The usage example demonstrates the API; it is not yet wired into `Game` or `HubScene`.
