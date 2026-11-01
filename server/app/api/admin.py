from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.admin.access import require_admin
from app.admin import world
from app.admin import access
from app.database.connection import get_db
from app.database.models import User, Progress
from app.admin.player_settings import speed_setting
from app.game.room_manager import room_manager
from app.websocket.manager import manager
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import time
import threading

router = APIRouter(prefix='/api', tags=['World administration'])
rights_lock = threading.Lock()

class AdminRightsRequest(BaseModel):
    admin: bool

@router.get('/admin/players')
async def admin_players(admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    users = (await session.execute(select(User).order_by(User.username))).scalars().all()
    ids = access.admin_ids()
    now = time.monotonic()
    result = []
    for user in users:
        player = room_manager.get_player(user.id)
        room = room_manager.get_player_room(user.id)
        fresh = bool(player and now - player.metrics_at < 20)
        multiplier, _ = await speed_setting(session, user.id)
        result.append({'id': user.id, 'username': user.username, 'admin': user.id in ids, 'speedMultiplier': multiplier,
                       'online': player is not None, 'room': room.room_id if room else None,
                       'fps': player.fps if fresh else None, 'ping': player.ping_ms if fresh else None})
    return {'players': result, 'selfId': admin.id}

class PlayerSettingsRequest(BaseModel):
    speedMultiplier: float = Field(ge=0.25, le=2.0, allow_inf_nan=False)

@router.put('/admin/players/{user_id}/settings')
async def set_player_settings(user_id: int, request: PlayerSettingsRequest, admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    if await session.get(User, user_id) is None: raise HTTPException(404, 'Игрок не найден')
    _, row = await speed_setting(session, user_id)
    if row is None:
        row = Progress(user_id=user_id, course_id='admin_settings', lesson_id='speed_multiplier')
        session.add(row)
    row.status = str(request.speedMultiplier)
    await session.commit()
    player = room_manager.get_player(user_id)
    if player: player.speed_multiplier = request.speedMultiplier
    return {'id': user_id, 'speedMultiplier': request.speedMultiplier}

@router.put('/admin/players/{user_id}/rights')
async def set_admin_rights(user_id: int, request: AdminRightsRequest, admin: User = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    target = await session.get(User, user_id)
    if target is None: raise HTTPException(404, 'Игрок не найден')
    if request.admin and not target.is_active: raise HTTPException(400, 'Учётная запись отключена')
    with rights_lock:
        ids = access.admin_ids()
        if admin.id not in ids: raise HTTPException(403, 'Нет прав администратора')
        if not request.admin and user_id == admin.id: raise HTTPException(400, 'Нельзя снять собственные права')
        if request.admin: ids.add(user_id)
        else: ids.discard(user_id)
        access.write_admin_ids(ids)
    return {'id': user_id, 'admin': user_id in ids}

@router.post('/admin/players/{user_id}/disconnect')
async def disconnect_player(user_id: int, admin: User = Depends(require_admin)):
    if user_id == admin.id: raise HTTPException(400, 'Нельзя отключить себя')
    socket = manager.connections.get(user_id)
    if socket is None: raise HTTPException(404, 'Игрок не подключён')
    await socket.close(code=4003, reason='Отключён администратором')
    return {'id': user_id, 'disconnected': True}

class SaveRequest(BaseModel):
    revision: str = Field(pattern=r'^[0-9a-f]{64}$')
    world: world.World

class RestoreRequest(BaseModel):
    revision: str = Field(pattern=r'^[0-9a-f]{64}$')
    backup: str = Field(max_length=80)

@router.get('/world')
def public_world():
    data, revision = world.read()
    return {'world': data.model_dump(exclude_none=True), 'revision': revision}

@router.get('/admin/world', dependencies=[Depends(require_admin)])
def admin_world():
    return public_world()

@router.get('/admin/world/backups', dependencies=[Depends(require_admin)])
def backups():
    return {'backups': world.versions()}

@router.put('/admin/world', dependencies=[Depends(require_admin)])
def save(request: SaveRequest):
    try: return {'revision': world.save(request.world, request.revision)}
    except ValueError as error: raise HTTPException(409, str(error)) from error

@router.post('/admin/world/restore', dependencies=[Depends(require_admin)])
def restore(request: RestoreRequest):
    try: return {'revision': world.restore(request.backup, request.revision)}
    except FileNotFoundError as error: raise HTTPException(404, 'Резервная копия не найдена') from error
    except ValueError as error: raise HTTPException(409, str(error)) from error

@router.post('/admin/world/validate', dependencies=[Depends(require_admin)])
def validate(draft: world.World):
    return {'world': draft.model_dump(exclude_none=True)}

@router.get('/admin/world/backups/{name}', dependencies=[Depends(require_admin)])
def backup(name: str):
    try: return {'world': world.read_backup(name).model_dump(exclude_none=True)}
    except FileNotFoundError as error: raise HTTPException(404, 'Резервная копия не найдена') from error
    except ValueError as error: raise HTTPException(409, str(error)) from error
