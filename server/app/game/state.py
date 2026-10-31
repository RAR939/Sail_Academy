from dataclasses import dataclass, field

from app.game.room import Room


@dataclass
class GameState:
    rooms: dict[str, Room] = field(default_factory=dict)

    # user_id -> room_id
    player_rooms: dict[int, str] = field(default_factory=dict)

    def add_room(self, room: Room):
        if room.room_id in self.rooms:
            raise ValueError(
                f"Room already exists: {room.room_id}"
            )

        self.rooms[room.room_id] = room

    def get_room(self, room_id: str) -> Room | None:
        return self.rooms.get(room_id)

    def get_player_room(self, user_id: int) -> Room | None:
        room_id = self.player_rooms.get(user_id)

        if room_id is None:
            return None

        return self.rooms.get(room_id)

    def get_player(self, user_id: int):
        room = self.get_player_room(user_id)

        if room is None:
            return None

        return room.get_player(user_id)
