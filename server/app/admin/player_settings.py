"""Persistent per-player settings without changing existing database schemas."""
from sqlalchemy import select
from app.database.models import Progress

async def speed_setting(session, user_id: int) -> tuple[float, Progress | None]:
    result = await session.execute(select(Progress).where(Progress.user_id == user_id, Progress.course_id == 'admin_settings', Progress.lesson_id == 'speed_multiplier'))
    row = result.scalar_one_or_none()
    try:
        value = float(row.status) if row else 1.0
        if not 0.25 <= value <= 2.0: value = 1.0
    except (TypeError, ValueError): value = 1.0
    return value, row
