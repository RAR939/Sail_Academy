"""Administrator IDs are granted only through the server console."""
import json
import os
import tempfile
from pathlib import Path
from fastapi import Depends, HTTPException
from app.database.models import User
from app.security.dependencies import get_current_user

ADMIN_PATH = Path(__file__).resolve().parents[2] / 'data' / 'admins.json'

def admin_ids() -> set[int]:
    if not ADMIN_PATH.exists(): return set()
    try:
        data = json.loads(ADMIN_PATH.read_text(encoding='utf-8'))
        if not isinstance(data, list) or any(type(x) is not int or x <= 0 for x in data): raise ValueError()
        return set(data)
    except (OSError, ValueError, json.JSONDecodeError):
        return set()  # Fail closed if the access list is corrupt.

def write_admin_ids(ids: set[int]) -> None:
    ADMIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.admins-', dir=ADMIN_PATH.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(sorted(ids), f); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(temp, ADMIN_PATH)
    finally:
        if os.path.exists(temp): os.unlink(temp)

async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.id not in admin_ids(): raise HTTPException(403, 'Нет прав администратора')
    return user
