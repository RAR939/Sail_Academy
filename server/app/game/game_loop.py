import asyncio
import logging
import time

from app.game.constants import TICK_INTERVAL
from app.game.room_manager import room_manager
from app.game.boat_physics import BoatPhysics
from app.world.wind import WindState

from app.websocket.manager import manager


logger = logging.getLogger(__name__)


class GameLoop:
    def __init__(self):
        self.running = False
        self.wind = WindState()
        self.tick_count = 0

    async def start(self):
        if self.running:
            logger.warning("Game loop is already running")
            return

        self.running = True
        previous_time = time.monotonic()

        logger.info("Game loop started")

        try:
            while self.running:
                tick_start = time.monotonic()

                delta_time = tick_start - previous_time
                previous_time = tick_start

                await self.update(delta_time)

                self.tick_count += 1

                elapsed = time.monotonic() - tick_start
                sleep_time = max(0.0, TICK_INTERVAL - elapsed)

                await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("Game loop cancelled")
            raise

        finally:
            self.running = False
            logger.info("Game loop stopped")

    def stop(self):
        self.running = False

    async def update(self, delta_time: float):
        self.wind.update(delta_time)

        for room in list(room_manager.state.rooms.values()):
            if room.is_empty():
                continue

            now = time.monotonic()
            # Во время отсчёта лодки свободно маневрируют.
            for user_id, boat in room.boats.items():
                if room.room_type != "race" or room.race_start_at is None:
                    continue
                race = room.races.get(user_id)
                if not race:
                    continue
                step = min(max(delta_time, 0.0), 0.1)
                if now < room.race_start_at:
                    BoatPhysics.update(boat, self.wind, step)
                    continue
                if not race.start_checked:
                    before_signal = max(0.0, min(step, room.race_start_at - (now - step)))
                    if before_signal:
                        BoatPhysics.update(boat, self.wind, before_signal)
                    race.apply_start_signal((boat.x, boat.z), boat.heading)
                    step -= before_signal
                before = (boat.x, boat.z)
                if step:
                    BoatPhysics.update(boat, self.wind, step)
                race.update(before, (boat.x, boat.z), now, boat.heading)

            # Формируем обновление состояния игроков.
            players_delta = []

            for user_id, player in room.players.items():
                player_data = player.to_dict()

                boat = room.get_boat(user_id)

                if boat is not None:
                    player_data["boat"] = boat.to_dict()

                players_delta.append(player_data)

            # Отправляем только участникам этой комнаты.
            await manager.send_room(
                room,
                {
                    "t": "players",
                    "delta": players_delta
                }
            )

            if room.room_type == "race":
                await manager.send_room(room, room.lobby_snapshot(now))
                for user_id, race in room.races.items():
                    await manager.send_personal(user_id, {"t": "race_state", **race.snapshot()})

            # Отдельно передаём актуальное состояние ветра.
            await manager.send_room(
                room,
                {
                    "t": "wind",
                    **self.wind.to_dict()
                }
            )


game_loop = GameLoop()
