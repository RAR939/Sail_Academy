import asyncio
import logging
import time

from app.game.constants import TICK_INTERVAL
from app.game.room_manager import room_manager
from app.game.boat_physics import BoatPhysics
from app.world.wind import WindState
from app.game.race_results import save_race_results
from app.game.race_judging import update_judging

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
            if room.room_type == "race" and room.race_start_at is not None and room.race_database_id is None:
                try:
                    await save_race_results(room)
                except Exception:
                    logger.exception("Could not save race start for %s", room.room_id)
            # First move every boat, then judge their common positions.
            previous_headings = {uid: boat.heading for uid, boat in room.boats.items()}
            movements = {}
            for user_id, boat in list(room.boats.items()):
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
                movements[user_id] = (before, (boat.x, boat.z), boat.heading)

            if room.room_type == "race" and room.race_start_at is not None:
                update_judging(room, self.wind.direction, previous_headings)
                for user_id, (before, after, heading) in movements.items():
                    race = room.races.get(user_id)
                    if race:
                        race.update(before, after, now, heading)

            if room.room_type == "race" and room.race_database_id is not None:
                finished = [(uid, race.finished_in) for uid, race in room.races.items() if race.finished_in is not None]
                finished += [(item["id"], item["elapsed"]) for item in room.race_results.values() if item["elapsed"] is not None]
                finished.sort(key=lambda item: item[1])
                if tuple(finished) != room.saved_results:
                    try:
                        await save_race_results(room)
                    except Exception:
                        logger.exception("Could not save race results for %s", room.room_id)

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
