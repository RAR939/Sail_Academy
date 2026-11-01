"""Validated world document with atomic, optimistic writes and immutable backups."""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WORLD_PATH = Path(__file__).resolve().parents[3] / "shared" / "world" / "hub.json"
BACKUP_DIR = WORLD_PATH.parent / "backups"
_lock = threading.RLock()
_cache_key = None
_cache_value = None

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class PlayerConfig(StrictModel):
    walkSpeed: float = Field(gt=0, le=12)
    runSpeed: float = Field(gt=0, le=12)
    acceleration: float = Field(gt=0, le=200)
    braking: float = Field(gt=0, le=300)
    gravity: float = Field(ge=-100, lt=0)
    turnSpeed: float = Field(gt=0, le=100)
    @model_validator(mode="after")
    def check_speeds(self):
        if self.walkSpeed > self.runSpeed: raise ValueError("Скорость ходьбы должна быть не выше скорости бега")
        return self

class CameraConfig(StrictModel):
    distance: float = Field(ge=1, le=30)
    minDistance: float = Field(ge=0.5, le=30)
    maxDistance: float = Field(ge=1, le=40)
    height: float = Field(ge=-1, le=5)
    beta: float = Field(ge=0.45, le=1.43)
    followSpeed: float = Field(gt=0, le=20)
    manualDelay: float = Field(ge=0, le=10)
    @model_validator(mode="after")
    def check_distance(self):
        if not self.minDistance <= self.distance <= self.maxDistance: raise ValueError("Неверные пределы дистанции камеры")
        return self

Vec3 = tuple[float, float, float]
class Box(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    size: Vec3
    position: Vec3
    material: str = Field(min_length=1, max_length=80)
    collision: bool
    visible: bool
    @field_validator('size')
    @classmethod
    def positive_size(cls, v):
        if any(x <= 0 or x > 1000 for x in v): raise ValueError('Размеры должны быть от 0 до 1000')
        return v

class Cylinder(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    height: float = Field(gt=0, le=1000)
    diameter: float = Field(gt=0, le=1000)
    position: Vec3
    material: str = Field(min_length=1, max_length=80)

class Label(StrictModel):
    text: str = Field(min_length=1, max_length=120)
    position: Vec3
    width: float = Field(gt=0, le=50)
    height: float = Field(gt=0, le=20)
    billboard: bool

class NPC(StrictModel):
    id: str
    name: str = Field(min_length=1, max_length=60)
    role: str = Field(min_length=1, max_length=100)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    x: float = Field(ge=-200, le=200)
    z: float = Field(ge=-200, le=200)
    skin: str = Field(pattern=r'^(skaterMaleA|skaterFemaleA|criminalMaleA|cyborgFemaleA)$')

class Sea(StrictModel):
    width: float = Field(gt=0, le=2000)
    height: float = Field(gt=0, le=2000)
    position: Vec3
class Environment(StrictModel):
    sky: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    fogStart: float = Field(ge=0, le=2000)
    fogEnd: float = Field(gt=0, le=3000)
    lightIntensity: float = Field(ge=0, le=3)
    sea: Sea
    materials: dict[str, str]
    @model_validator(mode='after')
    def check_values(self):
        if self.fogEnd <= self.fogStart: raise ValueError('Конец тумана должен быть дальше начала')
        if not {'sea','pier-wood','ivory-walls','metal'} <= self.materials.keys(): raise ValueError('Отсутствует обязательный материал')
        if any(not re.fullmatch(r'#[0-9a-fA-F]{6}', c) for c in self.materials.values()): raise ValueError('Цвета задаются в формате #RRGGBB')
        return self
class SpecialPart(StrictModel):
    position: Vec3
    diameter: float = Field(gt=0, le=100)
    height: float | None = Field(default=None, gt=0, le=100)
    scale: Vec3 | None = None
class Special(StrictModel):
    bow: SpecialPart
    sail: SpecialPart

class World(StrictModel):
    version: int = Field(ge=1, le=1)
    player: PlayerConfig
    camera: CameraConfig
    environment: Environment
    boxes: list[Box] = Field(min_length=1, max_length=500)
    cylinders: list[Cylinder] = Field(max_length=500)
    labels: list[Label] = Field(max_length=200)
    npcs: list[NPC] = Field(min_length=4, max_length=4)
    stations: dict[str, Vec3]
    props: list[tuple[str, float, float, float]] = Field(max_length=200)
    special: Special
    @model_validator(mode='after')
    def check_world(self):
        if {n.id for n in self.npcs} != {'captain','weather','judge','sailor'}: raise ValueError('Нужны четыре существующих NPC с уникальными ID')
        if set(self.stations) != {'vest', 'pier'}: raise ValueError('Нужны станции vest и pier')
        if any(item.material not in self.environment.materials for item in [*self.boxes,*self.cylinders]): raise ValueError('Неизвестный материал')
        if len([b for b in self.boxes if b.name=='wind-flag']) != 1 or len([b for b in self.boxes if b.name=='training-dinghy']) != 1: raise ValueError('Нужны wind-flag и training-dinghy')
        if not any(b.name.startswith('orange-vest-') for b in self.boxes): raise ValueError('Нужна модель жилета')
        if self.special.bow.height is None or self.special.sail.scale is None or any(v <= 0 or v > 100 for v in self.special.sail.scale): raise ValueError('Некорректные размеры лодки или паруса')
        for path, x, z, scale in self.props:
            if not re.fullmatch(r'(environment|props)/[a-z0-9_]+', path) or not 0 < scale <= 20 or max(abs(x),abs(z)) > 1000: raise ValueError('Недопустимое размещение модели')
        for vector in [*(b.position for b in self.boxes), *(c.position for c in self.cylinders), *(l.position for l in self.labels), *self.stations.values()]:
            if any(not math.isfinite(v) or abs(v) > 2000 for v in vector): raise ValueError('Координаты должны быть в пределах мира')
        return self

def encode(world: World) -> bytes:
    return (json.dumps(world.model_dump(exclude_none=True), ensure_ascii=False, indent=2) + '\n').encode()

def revision(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def read() -> tuple[World, str]:
    global _cache_key, _cache_value
    with _lock:
        stat = WORLD_PATH.stat()
        key = (str(WORLD_PATH), stat.st_mtime_ns, stat.st_size, stat.st_ino)
        if key != _cache_key:
            data = WORLD_PATH.read_bytes()
            _cache_value = (World.model_validate_json(data), revision(data))
            _cache_key = key
        return _cache_value

def _atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.world-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def save(world: World, expected: str) -> str:
    with _lock:
        old = WORLD_PATH.read_bytes()
        if revision(old) != expected: raise ValueError('Мир изменился после открытия редактора. Обновите данные.')
        # Validate both versions before creating a backup or replacing the document.
        World.model_validate_json(old)
        data = encode(world)
        if old == data: return revision(old)
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '-' + revision(old)[:12] + '.json'
        _atomic_write(BACKUP_DIR / name, old)
        _atomic_write(WORLD_PATH, data)
        return revision(data)

def versions() -> list[dict[str, Any]]:
    if not BACKUP_DIR.exists(): return []
    return [{'id': p.name, 'size': p.stat().st_size} for p in sorted(BACKUP_DIR.glob('*.json'), reverse=True) if re.fullmatch(r'\d{8}T\d{6}\.\d{6}Z-[0-9a-f]{12}\.json', p.name)]

def restore(name: str, expected: str) -> str:
    if not re.fullmatch(r'\d{8}T\d{6}\.\d{6}Z-[0-9a-f]{12}\.json', name): raise FileNotFoundError(name)
    with _lock:
        data = (BACKUP_DIR / name).read_bytes()
        if revision(data)[:12] != name[-17:-5]: raise ValueError('Резервная копия повреждена')
        return save(World.model_validate_json(data), expected)

def read_backup(name: str) -> World:
    if not re.fullmatch(r'\d{8}T\d{6}\.\d{6}Z-[0-9a-f]{12}\.json', name): raise FileNotFoundError(name)
    data = (BACKUP_DIR / name).read_bytes()
    if revision(data)[:12] != name[-17:-5]: raise ValueError('Резервная копия повреждена')
    return World.model_validate_json(data)
