import asyncio
import json
import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.content import NPCS, STEPS, STORY_REPLIES
from app.admin import world as world_config
from app.ai.service import answer
from app.database.connection import get_db
from app.database.models import NPCMemory, Progress, User
from app.game.room_manager import room_manager
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["Shore lesson"])
story_lock = asyncio.Lock()
dialogue_lock = asyncio.Lock()
COURSE = "shore_intro"


class InteractionRequest(BaseModel):
    target: str = Field(min_length=1, max_length=32)


class DialogRequest(BaseModel):
    npc_id: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1, max_length=600)


async def progress_row(session: AsyncSession, user_id: int) -> Progress:
    result = await session.execute(select(Progress).execution_options(populate_existing=True).where(
        Progress.user_id == user_id, Progress.course_id == COURSE, Progress.lesson_id == "first_day"
    ))
    row = result.scalar_one_or_none()
    if row is None:
        row = Progress(user_id=user_id, course_id=COURSE, lesson_id="first_day", status=STEPS[0][0])
        session.add(row)
        await session.flush()
    return row


def index_of(row: Progress) -> int:
    return next((i for i, step in enumerate(STEPS) if step[0] == row.status), 0)


async def vest_state(session: AsyncSession, row: Progress) -> tuple[bool, Progress | None]:
    result = await session.execute(select(Progress).execution_options(populate_existing=True).where(
        Progress.user_id == row.user_id, Progress.course_id == "equipment", Progress.lesson_id == "lifejacket"
    ))
    equipment = result.scalar_one_or_none()
    return (equipment.status == "worn" if equipment else index_of(row) >= 3), equipment


def snapshot(row: Progress, has_vest: bool | None = None) -> dict:
    index = index_of(row)
    step_id, title, description, target, (x, z) = STEPS[index]
    world = world_config.read()[0]
    npc_positions = {npc.id: (npc.x, npc.z) for npc in world.npcs}
    if target in npc_positions:
        x, z = npc_positions[target]
    elif target in world.stations:
        x, _, z = world.stations[target]
    return {
        "step": step_id, "index": index, "total": len(STEPS) - 1,
        "title": title, "description": description,
        "target": target, "position": {"x": x, "z": z},
        "has_vest": index >= 3 if has_vest is None else has_vest, "completed": step_id == "completed",
    }


def require_near(user_id: int, position: tuple[float, float]):
    room = room_manager.get_player_room(user_id)
    player = room.get_player(user_id) if room else None
    if not player or room.room_id != "hub":
        raise HTTPException(409, "Сначала войдите в береговой хаб.")
    if math.hypot(player.x - position[0], player.z - position[1]) > 4:
        raise HTTPException(409, "Подойдите ближе к персонажу или предмету.")


@router.get("/story")
async def get_story(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)):
    async with story_lock:
        row = await progress_row(session, user.id)
        worn, _ = await vest_state(session, row)
        player = room_manager.get_player(user.id)
        if player:
            player.has_vest = worn
        result = snapshot(row, worn)
        await session.commit()
        return result


@router.post("/story/interact")
async def interact(data: InteractionRequest, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)):
    if data.target not in ("vest", "pier"):
        raise HTTPException(400, "Неизвестный предмет.")
    x, _, z = world_config.read()[0].stations[data.target]
    require_near(user.id, (x, z))
    async with story_lock:
        row = await progress_row(session, user.id)
        index = index_of(row)
        advanced = STEPS[index][3] == data.target
        worn, equipment = await vest_state(session, row)
        if advanced:
            row.status = STEPS[index + 1][0]
            if data.target == "vest":
                worn = True
        elif data.target == "vest" and index >= 3:
            worn = not worn
            if equipment is None:
                equipment = Progress(user_id=user.id, course_id="equipment", lesson_id="lifejacket")
                session.add(equipment)
            equipment.status = "worn" if worn else "removed"
        state = snapshot(row, worn)
        await session.commit()
        player = room_manager.get_player(user.id)
        if player:
            player.has_vest = worn
    if advanced:
        message = ("Жилет подобран по размеру и застёгнут. Теперь найдите судью Анну." if data.target == "vest"
                   else "Вы осмотрели нос, корму, парус и румпель учебной лодки. На воду сегодня не выходим. Вернитесь к капитану.")
    elif data.target == "vest" and index >= 3:
        message = "Жилет надет и застёгнут." if worn else "Жилет снят и оставлен на стойке."
    else:
        message = "Сначала выполните текущее задание: " + state["description"]
    return {"story": state, "text": message}


@router.post("/ai/dialog")
async def dialog(data: DialogRequest, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)):
    npc = NPCS.get(data.npc_id)
    if npc is None:
        raise HTTPException(404, "Такого наставника нет.")
    if not data.text.strip():
        raise HTTPException(422, "Введите вопрос.")
    location = next(item for item in world_config.read()[0].npcs if item.id == data.npc_id)
    npc = {**npc, "name": location.name, "position": (location.x, location.z)}
    require_near(user.id, (location.x, location.z))
    # Bound queueing as well as model time; serialize memory updates for this demo.
    try:
        await asyncio.wait_for(dialogue_lock.acquire(), timeout=2)
    except TimeoutError:
        raise HTTPException(429, "Наставник сейчас занят. Попробуйте через несколько секунд.")
    try:
        result = await session.execute(select(NPCMemory).where(NPCMemory.user_id == user.id, NPCMemory.npc_id == data.npc_id))
        memory = result.scalar_one_or_none()
        try:
            history = json.loads(memory.memory_text) if memory else []
            if not isinstance(history, list):
                history = []
            history = [message for message in history if isinstance(message, dict)
                       and message.get("role") in ("user", "assistant") and isinstance(message.get("content"), str)]
        except (ValueError, TypeError):
            history = []
        async with story_lock:
            row = await progress_row(session, user.id)
            index = index_of(row)
            expected = STEPS[index][3] == data.npc_id
            lesson = STORY_REPLIES.get(STEPS[index][0], "") if expected else ""
            # Release the DB read transaction before waiting for the model.
            await session.commit()
        repeated = any(message.get("role") == "user" and message.get("content", "").casefold() == data.text.strip().casefold() for message in history)
        overrides = {"name": location.name}
        if location.style: overrides["style"] = location.style
        if location.facts: overrides["facts"] = location.facts
        text, backend = await answer(data.npc_id, data.text.strip(), history, lesson, repeated, overrides)
        async with story_lock:
            row = await progress_row(session, user.id)
            if lesson and index_of(row) == index:
                row.status = STEPS[index + 1][0]
            worn, _ = await vest_state(session, row)
            state = snapshot(row, worn)
            if memory is None:
                memory = NPCMemory(user_id=user.id, npc_id=data.npc_id)
                session.add(memory)
            memory.memory_text = json.dumps([
                *history[-4:], {"role": "user", "content": data.text.strip()},
                {"role": "assistant", "content": text},
            ], ensure_ascii=False)
            await session.commit()
        return {"npc_id": data.npc_id, "speaker": npc["name"], "text": text, "backend": backend, "story": state}
    finally:
        dialogue_lock.release()
