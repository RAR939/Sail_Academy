# Client multiplayer integration patch

Apply this patch over the current repository root. It adds:
- a minimal login overlay using the existing `/api/auth/login` endpoint;
- WebSocket connection to `/ws/game`;
- Vite dev-server proxy for `/api` and `/ws` (including WebSocket upgrade);
- local player movement snapshots sent at approximately 15 Hz;
- remote player capsule meshes updated from room snapshots;
- 100 ms interpolation for remote player movement.

## Assumptions and current limitations

- The current backend protocol uses `t` as the message discriminator.
- The Vite dev server and FastAPI backend are expected to run on the same host by default. Override `VITE_BACKEND_TARGET` if the backend is elsewhere.
- Vite listens on `0.0.0.0`, allowing other computers on the LAN to open the client dev server. Allow the Vite port (5173) through the host firewall.
- The local player capsule is positioned with its origin at y=1.1 while the backend player state starts at y=0. The integration translates local y by -1.1 when sending and +1.1 when rendering remote players.
- Remote player removal works because the current backend broadcasts full room snapshots. There is no explicit `player_left` message.
- Boat rendering/control is not connected in this patch.
- The login form expects an account already registered through `/api/auth/register`; registration UI is not included.
- Do not commit real `.env` files or credentials.

## Apply and verify

1. Extract the archive into the repository root, preserving folder structure.
2. From `client/`, run `npm run build`.
3. Start FastAPI on the same host at `127.0.0.1:8000`.
4. Start Vite with `npm run dev -- --host 0.0.0.0`.
5. Open the Vite URL, log in with an existing backend account, then open the same URL on a second computer and log in with a different account.
6. Confirm both players are visible and movement is synchronized.

If TypeScript reports errors, share the complete build output before changing other files.
