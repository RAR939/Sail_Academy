from uuid import uuid4

from app.game.state import GameState
from app.game.room import Room
from app.game.player import PlayerState
from app.game.boat import BoatState


MAX_RACE_PLAYERS = 4


class RoomManager:
    def __init__(self, state: GameState | None = None):
        self.state = state or GameState()

        if "hub" not in self.state.rooms:
            self.create_room(
                room_id="hub",
                room_type="hub",
                location_id="club"
            )

    def create_room(
        self,
        room_id: str,
        room_type: str,
        location_id: str
    ) -> Room:
        if room_id in self.state.rooms:
            raise ValueError(f"Room already exists: {room_id}")

        room = Room(
            room_id=room_id,
            room_type=room_type,
            location_id=location_id
        )

        self.state.add_room(room)
        return room

    def create_race_room(self) -> Room:
        room_id = f"race_{uuid4().hex[:8]}"

        return self.create_room(
            room_id=room_id,
            room_type="race",
            location_id="race_track"
        )

    def get_or_create_training_room(
        self,
        location_id: str
    ) -> Room:
        room_id = f"training_{location_id}"

        room = self.state.get_room(room_id)

        if room is None:
            room = self.create_room(
                room_id=room_id,
                room_type="training",
                location_id=location_id
            )

        return room

    def get_room(self, room_id: str) -> Room:
        room = self.state.get_room(room_id)

        if room is None:
            raise KeyError(f"Room not found: {room_id}")

        return room

    def can_join(self, room: Room, user_id: int) -> bool:
        if user_id in room.players:
            return True

        if room.room_type == "race":
            return room.race_start_at is None and room.get_player_count() < MAX_RACE_PLAYERS

        return True

    def add_player(
        self,
        player: PlayerState,
        room_id: str = "hub",
        boat: BoatState | None = None
    ):
        room = self.get_room(room_id)

        if not self.can_join(room, player.user_id):
            raise ValueError("Room is full")

        user_id = player.user_id
        old_room_id = self.state.player_rooms.get(user_id)

        if old_room_id is not None:
            old_room = self.state.get_room(old_room_id)

            if old_room is not None:
                old_room.remove_player(user_id)

        room.add_player(player, boat)
        self.state.player_rooms[user_id] = room_id

    def move_player(
        self,
        user_id: int,
        target_room_id: str
    ):
        target_room = self.get_room(target_room_id)

        old_room_id = self.state.player_rooms.get(user_id)

        if old_room_id is None:
            raise ValueError(
                f"Player is not in any room: {user_id}"
            )

        if old_room_id == target_room_id:
            return

        if not self.can_join(target_room, user_id):
            raise ValueError("Комната заполнена или отсчёт уже начался")

        old_room = self.get_room(old_room_id)

        player = old_room.get_player(user_id)
        boat = old_room.get_boat(user_id)

        if player is None:
            raise RuntimeError(
                f"Player {user_id} missing from room {old_room_id}"
            )

        old_room.remove_player(user_id)
        target_room.add_player(player, boat)

        self.state.player_rooms[user_id] = target_room_id

        # Пустые гоночные комнаты удаляются автоматически.
        if old_room.room_type == "race" and old_room.is_empty():
            self.state.rooms.pop(old_room_id, None)

    def remove_player(self, user_id: int) -> PlayerState | None:
        room_id = self.state.player_rooms.pop(user_id, None)

        if room_id is None:
            return None

        room = self.state.get_room(room_id)

        if room is None:
            return None

        player = room.remove_player(user_id)

        if room.room_type == "race" and room.is_empty():
            self.state.rooms.pop(room_id, None)

        return player

    def get_player(self, user_id: int) -> PlayerState | None:
        return self.state.get_player(user_id)

    def get_player_room(self, user_id: int) -> Room | None:
        return self.state.get_player_room(user_id)

    def get_room_players(self, room_id: str) -> list[dict]:
        return self.get_room(room_id).get_players()

    def get_all_rooms(self) -> list[dict]:
        return [
            {
                "id": room.room_id,
                "type": room.room_type,
                "location": room.location_id,
                "players": room.get_player_count()
            }
            for room in self.state.rooms.values()
        ]


room_manager = RoomManager()
