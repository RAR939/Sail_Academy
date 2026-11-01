from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.admin.access import require_admin
from app.admin import world

router = APIRouter(prefix='/api', tags=['World administration'])

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
