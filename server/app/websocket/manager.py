import logging

from fastapi import WebSocket
from app.game.room import Room

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.connections: dict[int, WebSocket] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        old_connection = self.connections.get(user_id)
        self.connections[user_id] = websocket

        if old_connection is not None and old_connection is not websocket:
            try:
                await old_connection.close(
                    code=4001,
                    reason="Connection replaced"
                )
            except Exception:
                pass

    def disconnect(
        self,
        user_id: int,
        websocket: WebSocket | None = None
    ):
        current = self.connections.get(user_id)

        if current is None:
            return

        if websocket is not None and current is not websocket:
            return

        self.connections.pop(user_id, None)

    def get_connected_users(self) -> list[int]:
        return list(self.connections.keys())

    def is_connected(self, user_id: int) -> bool:
        return user_id in self.connections

    async def send_personal(self, user_id: int, message: dict):
        websocket = self.connections.get(user_id)

        if websocket is None:
            return

        try:
            await websocket.send_json(message)
        except Exception:
            logger.exception(
                "Failed to send message to user %s",
                user_id
            )
            self.disconnect(user_id, websocket)

    async def send_room(self, room: Room, message: dict):
        disconnected = []

        for user_id in list(room.players.keys()):
            websocket = self.connections.get(user_id)

            if websocket is None:
                continue

            try:
                await websocket.send_json(message)
            except Exception:
                logger.exception(
                    "Failed to send room message to user %s",
                    user_id
                )
                disconnected.append((user_id, websocket))

        for user_id, websocket in disconnected:
            self.disconnect(user_id, websocket)

    async def broadcast(self, message: dict):
        disconnected = []

        for user_id, websocket in list(self.connections.items()):
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append((user_id, websocket))

        for user_id, websocket in disconnected:
            self.disconnect(user_id, websocket)


manager = ConnectionManager()
