"""Persist race results as soon as the race starts and each boat finishes."""
from datetime import datetime

from sqlalchemy import select

from app.database.connection import AsyncSessionLocal
from app.database.models import Race, RaceParticipant


async def save_race_results(room):
    async with AsyncSessionLocal() as session:
        if room.race_database_id is None:
            race = Race(name=room.room_id, status="racing", started_at=datetime.utcnow())
            session.add(race)
            await session.flush()
            race_id = race.id
            for user_id in room.players:
                session.add(RaceParticipant(race_id=race_id, user_id=user_id, penalty_points=0))
        else:
            race_id = room.race_database_id
        rows = (await session.execute(select(RaceParticipant).where(RaceParticipant.race_id == race_id))).scalars().all()
        finished = sorted(((uid, progress.finished_in) for uid, progress in room.races.items() if progress.finished_in is not None), key=lambda item: item[1])
        finished += [(item["id"], item["elapsed"]) for item in room.race_results.values() if item["elapsed"] is not None]
        finished.sort(key=lambda item: item[1])
        by_id = {user_id: (place, elapsed) for place, (user_id, elapsed) in enumerate(finished, 1)}
        for row in rows:
            if row.user_id in by_id:
                row.finish_position, row.finish_time = by_id[row.user_id]
        await session.commit()
        room.race_database_id = race_id
        room.saved_results = tuple(finished)
