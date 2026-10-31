# Sail Academy — WebSocket protocol (current implementation)

This document records the protocol that is implemented in the current backend. It is a compatibility contract for the client, not a proposal for future features.

## Connection

- WebSocket endpoint: `/ws/game`
- The client connects to `ws://<server-host>:8000/ws/game` (or `wss://...` when TLS is configured).
- The first frame must be a JSON object with `t: "auth"` and a JWT access token.
- The server waits up to 3 seconds for this first frame.
- The canonical message discriminator is `t`. The current server also accepts `type` as a compatibility fallback, but clients should always send `t`.

## Client → server

### Authenticate
```json
{"t":"auth","token":"<JWT_ACCESS_TOKEN>"}
```

### Ping
```json
{"t":"ping"}
```
The server responds with `{"t":"pong"}`.

### Player movement
```json
{"t":"move","x":1.5,"y":0.0,"z":-2.0,"ry":1.2,"anim":"walk"}
```
Required: `x`, `y`, `z`, `ry`. `anim` is optional and may be a string up to 24 characters. The server validates finite numeric values and applies a movement-speed limit. The server does not send an immediate movement acknowledgement; the updated state is included in the periodic `players` message.

### Boat state input
```json
{"t":"boat","heading":0.8,"sailAngle":-0.35}
```
The current server accepts `heading` and `sailAngle`. `sailAngle` must be within `[-π, π]`. The server stores these values and the game loop advances boat physics. The client must **not** send `pos`, `rudder`, or `mainsheet` under this current contract.

### Create a race room
```json
{"t":"create_race"}
```
The server creates a race room, moves the player into it, then sends `location_changed` and `race_created`.

### Enter a location
Training area:
```json
{"t":"enter_location","locationId":"training_area"}
```
Club/hub:
```json
{"t":"enter_location","locationId":"club"}
```
Existing race room:
```json
{"t":"enter_location","locationId":"race_track","roomId":"race_a1b2c3d4"}
```
For `race_track`, `roomId` is required and must identify an existing race room.

## Server → client

### Welcome
```json
{
  "t":"welcome",
  "user_id":12,
  "username":"sailor",
  "room":"hub",
  "players":[
    {"id":12,"username":"sailor","x":0,"y":0,"z":0,"ry":0,"anim":"idle"}
  ]
}
```

### Player snapshots
```json
{
  "t":"players",
  "delta":[
    {
      "id":12,"username":"sailor",
      "x":0,"y":0,"z":0,"ry":0,"anim":"idle",
      "boat":{
        "ownerId":12,"pos":[0,0,0],"heading":0.8,"sailAngle":-0.35
      }
    }
  ]
}
```
**Important naming caveat:** `delta` is currently a full snapshot of the room's players, not a sparse delta. The server sends it from the game loop at approximately 15 Hz. The initial `welcome.players` and `location_changed.players` arrays are built by `Room.get_players()` and currently do not include nested boat data. The periodic `players.delta` entries do include a `boat` object when a boat exists. Client code should therefore treat `boat` as optional during initial synchronization.

### Wind
```json
{"t":"wind","speed":4.2,"direction":1.1}
```
`direction` is a numeric angle in radians as produced by the current `WindState`; confirm coordinate conventions with the client before using it for visual orientation.

### Location changed
```json
{
  "t":"location_changed",
  "roomId":"training_training_area",
  "roomType":"training",
  "locationId":"training_area",
  "players":[]
}
```
The client should replace its current room membership view with the supplied room and player list.

### Race created
```json
{"t":"race_created","roomId":"race_a1b2c3d4"}
```

### Error
```json
{"t":"error","message":"Room not found"}
```
Errors are currently plain text messages; there are no stable error codes yet.

## Current behavior and integration notes

1. `players.delta` is a room-wide snapshot sent to members of that room. It is not currently bandwidth-optimized delta replication.
2. Player movement is client-proposed and server-validated by a speed limit; this is not a fully server-simulated character controller.
3. Boat control currently sends `heading` and `sailAngle`. The server computes boat position/velocity from its physics loop. A future rudder/mainsheet input protocol would be a breaking protocol change and must be agreed by both teams first.
4. `welcome` and `location_changed` player arrays currently omit boats; periodic `players.delta` may include them. This is an implementation inconsistency to fix in a later backend change, not something the client should guess around.
5. There is no `player_left` message yet. On disconnect, the backend removes the player from room state; the current protocol does not explicitly notify remaining clients. This should be added before treating disconnect visualization as complete.
6. The server currently creates a new in-memory player and boat state on each authenticated connection and places the player in `hub`. Reconnection persistence is not guaranteed by this protocol.
7. The game loop broadcasts `wind` and `players` only to members of each room.

## Not part of the current contract

Do not implement these as if they already exist: `chunk_req`, `chunk`, `chunk_drop`, `race_state`, chat, NPC dialogue, quest updates, structured error codes, or rudder/mainsheet boat controls.
