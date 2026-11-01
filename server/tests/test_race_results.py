import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database.base import Base
from app.database.models import RaceParticipant, User
from app.game.boat import BoatState
from app.game.player import PlayerState
from app.game.room import Room
from app.game import race_results


@pytest.mark.asyncio
async def test_results_persist_and_remain_visible_after_departure(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(race_results, "AsyncSessionLocal", sessions)
    async with sessions() as session:
        session.add_all([User(id=1, username="one", password_hash="x"), User(id=2, username="two", password_hash="x")])
        await session.commit()
    room = Room("race_test", "race", "race_track")
    for uid, name in ((1, "one"), (2, "two")):
        room.add_player(PlayerState(user_id=uid, username=name), BoatState(owner_id=uid))
    room.start_countdown(1, 100)
    await race_results.save_race_results(room)
    room.races[1].finished_in = 40.0
    await race_results.save_race_results(room)
    room.remove_player(1)
    assert room.lobby_snapshot(500)["players"][0]["elapsed"] == 40.0
    room.races[2].finished_in = 30.0
    await race_results.save_race_results(room)
    async with sessions() as session:
        rows = (await session.execute(select(RaceParticipant).order_by(RaceParticipant.user_id))).scalars().all()
        assert [(row.finish_position, row.finish_time) for row in rows] == [(2, 40.0), (1, 30.0)]
    await engine.dispose()
