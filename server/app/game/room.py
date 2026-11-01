from dataclasses import dataclass, field
import time

from app.game.player import PlayerState
from app.game.boat import BoatState
from app.game.race import RaceProgress


@dataclass
class Room:
    room_id: str
    room_type: str
    location_id: str

    players: dict[int, PlayerState] = field(default_factory=dict)
    boats: dict[int, BoatState] = field(default_factory=dict)
    races: dict[int, RaceProgress] = field(default_factory=dict)

    created_at: float = field(default_factory=time.time)

    def add_player(
        self,
        player: PlayerState,
        boat: BoatState | None = None,
    ):
        self.players[player.user_id] = player

        if boat is not None:
            self.boats[player.user_id] = boat
            if self.room_type == "race":
                boat.x = (len(self.players) - 1) * 4.0 - 22.0
                boat.y = 0.0
                boat.z = -18.0
                boat.vx = boat.vz = 0.0
                boat.heading = boat.target_heading = 0.8
                boat.sail_angle = 0.5
                self.races[player.user_id] = RaceProgress()

    def remove_player(self, user_id: int) -> PlayerState | None:
        self.boats.pop(user_id, None)
        self.races.pop(user_id, None)
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
