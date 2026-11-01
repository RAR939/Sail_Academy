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
    race_host: int | None = None
    race_start_at: float | None = None

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
                if self.race_host is None:
                    self.race_host = player.user_id
                occupied = {round((other.x + 22.0) / 4.0) for owner, other in self.boats.items() if owner != player.user_id}
                slot = next(index for index in range(4) if index not in occupied)
                boat.x = slot * 4.0 - 22.0
                boat.y = 0.0
                boat.z = -18.0
                boat.vx = boat.vz = 0.0
                boat.heading = boat.target_heading = 0.8
                boat.sail_angle = 0.5
                self.races[player.user_id] = RaceProgress()

    def remove_player(self, user_id: int) -> PlayerState | None:
        self.boats.pop(user_id, None)
        self.races.pop(user_id, None)
        player = self.players.pop(user_id, None)
        if self.race_host == user_id:
            self.race_host = next(iter(self.players), None)
        return player

    def start_countdown(self, user_id: int, now: float, seconds: float = 180.0) -> None:
        if self.room_type != "race" or user_id != self.race_host:
            raise ValueError("Отсчёт может начать только создатель комнаты")
        if self.race_start_at is not None:
            raise ValueError("Отсчёт уже запущен")
        self.race_start_at = now + seconds
        for race in self.races.values():
            race.start_signal_at = self.race_start_at

    def lobby_snapshot(self, now: float) -> dict:
        phase = "waiting" if self.race_start_at is None else ("countdown" if now < self.race_start_at else "racing")
        results = []
        for user_id, player in self.players.items():
            race = self.races.get(user_id)
            results.append({"id": user_id, "name": player.username, "phase": race.phase if race else "start", "elapsed": race.finished_in if race else None, "individualRecall": race.individual_recall if race else False})
        results.sort(key=lambda item: (item["elapsed"] is None, item["elapsed"] if item["elapsed"] is not None else 0))
        return {"t": "race_lobby", "roomId": self.room_id, "hostId": self.race_host, "phase": phase,
                "secondsLeft": max(0.0, self.race_start_at - now) if self.race_start_at is not None else None,
                "players": results}

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
