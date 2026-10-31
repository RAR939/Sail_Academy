from dataclasses import dataclass, field
import time

from app.game.player import PlayerState
from app.game.boat import BoatState


@dataclass
class Room:
    room_id: str
    room_type: str
    location_id: str

    players: dict[int, PlayerState] = field(default_factory=dict)
    boats: dict[int, BoatState] = field(default_factory=dict)

    created_at: float = field(default_factory=time.time)

    def add_player(
        self,
        player: PlayerState,
        boat: BoatState | None = None,
    ):
        self.players[player.user_id] = player

        if boat is not None:
            self.boats[player.user_id] = boat

    def remove_player(self, user_id: int) -> PlayerState | None:
        self.boats.pop(user_id, None)
        return self.players.pop(user_id, None)

    def get_player(self, user_id: int) -> PlayerState | None:
        return self.players.get(user_id)

    def get_boat(self, user_id: int) -> BoatState | None:
        return self.boats.get(user_id)

    def get_players(self) -> list[dict]:
        return [
            player.to_dict()
            for player in self.players.values()
        ]

    def get_player_count(self) -> int:
        return len(self.players)

    def is_empty(self) -> bool:
        return len(self.players) == 0
