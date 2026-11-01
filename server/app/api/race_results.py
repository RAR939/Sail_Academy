from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.database.models import Race, RaceParticipant, User
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/api/races", tags=["Race results"])


@router.get("/history")
async def history(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)):
    races = (await session.execute(select(Race).join(RaceParticipant).where(
        RaceParticipant.user_id == user.id
    ).order_by(Race.id.desc()).limit(30))).scalars().all()
    result = []
    for race in races:
        rows = (await session.execute(select(RaceParticipant, User.username).join(User).where(
            RaceParticipant.race_id == race.id
        ).order_by(RaceParticipant.finish_position.is_(None), RaceParticipant.finish_position))).all()
        result.append({"id": race.id, "name": race.name, "startedAt": race.started_at,
                       "players": [{"name": name, "place": participant.finish_position,
                                    "elapsed": participant.finish_time} for participant, name in rows]})
    return result
