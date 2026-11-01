"""World edits are isolated until saved, validated, versioned and admin-only."""
import copy
import os
import shutil
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
os.environ.setdefault("JWT_SECRET", "shore-test-secret-only-0000000000000000")
from app import main
from app.admin import access, world
from app.security.dependencies import get_current_user

@pytest.fixture
def editor(tmp_path, monkeypatch):
    path = tmp_path / 'hub.json'
    shutil.copyfile(world.WORLD_PATH, path)
    monkeypatch.setattr(world, 'WORLD_PATH', path)
    monkeypatch.setattr(world, 'BACKUP_DIR', tmp_path / 'backups')
    monkeypatch.setattr(access, 'ADMIN_PATH', tmp_path / 'admins.json')
    async def noop():
        pass
    monkeypatch.setattr(main, "init_db", noop)
    monkeypatch.setattr(main, "close_db", noop)
    current = SimpleNamespace(id=17)
    main.app.dependency_overrides[get_current_user] = lambda: current
    try:
        with TestClient(main.app) as client:
            yield client, current
    finally:
        main.app.dependency_overrides.clear()

def test_permissions_validation_and_rollback(editor):
    client, user = editor
    assert client.get('/api/admin/world').status_code == 403
    assert client.get('/api/world').status_code == 200
    access.write_admin_ids({user.id})
    initial = client.get('/api/admin/world').json()
    draft = copy.deepcopy(initial['world'])
    draft['player']['runSpeed'] = 5
    draft['npcs'][0]['x'] += 2
    assert client.post('/api/admin/world/validate', json=draft).status_code == 200
    assert client.get('/api/world').json()['revision'] == initial['revision']
    invalid = copy.deepcopy(draft)
    invalid['boxes'][0]['size'][0] = -1
    assert client.put('/api/admin/world', json={'world': invalid, 'revision': initial['revision']}).status_code == 422
    assert client.get('/api/admin/world/backups').json()['backups'] == []
    result = client.put('/api/admin/world', json={'world': draft, 'revision': initial['revision']})
    assert result.status_code == 200
    saved_revision = result.json()['revision']
    assert client.get('/api/world').json()['world']['player']['runSpeed'] == 5
    assert client.put('/api/admin/world', json={'world': draft, 'revision': initial['revision']}).status_code == 409
    copies = client.get('/api/admin/world/backups').json()['backups']
    assert len(copies) == 1
    name = copies[0]['id']
    assert client.get('/api/admin/world/backups/' + name).json()['world']['player']['runSpeed'] == 4
    assert client.post('/api/admin/world/restore', json={'backup': name, 'revision': saved_revision}).status_code == 200
    assert client.get('/api/world').json()['world']['player']['runSpeed'] == 4
    assert len(client.get('/api/admin/world/backups').json()['backups']) == 2
    access.write_admin_ids(set())
    assert client.get('/api/admin/world/backups').status_code == 403

def test_world_coordinates_and_speed_are_authoritative(editor):
    from app.api import shore
    from app.game.player import PlayerState
    from app.websocket.router import validate_player_movement
    client, user = editor
    access.write_admin_ids({user.id})
    initial = client.get('/api/admin/world').json()
    draft = initial['world']
    draft['npcs'][0]['x'] = 8
    draft['player']['walkSpeed'] = 2
    draft['player']['runSpeed'] = 2
    assert client.put('/api/admin/world', json={'world': draft, 'revision': initial['revision']}).status_code == 200
    row = SimpleNamespace(status='meet_captain')
    assert shore.snapshot(row)['position'] == {'x': 8, 'z': 3}
    p = PlayerState(user_id=1, username='test')
    p.last_update = 10
    assert not validate_player_movement(p, 1.7, 0, 0, 10.5)
    assert validate_player_movement(p, 1.4, 0, 0, 10.5)

def test_console_grant_and_revoke(tmp_path, monkeypatch, capsys):
    import asyncio
    import sys
    import admin as console
    from app.database.base import Base
    from app.database.models import User
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'users.db'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def create_user():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            session.add(User(username='test_admin', password_hash='not-used'))
            await session.commit()
    asyncio.run(create_user())
    monkeypatch.setattr(access, 'ADMIN_PATH', tmp_path / 'admins.json')
    monkeypatch.setattr(console, 'AsyncSessionLocal', factory)
    monkeypatch.setattr(sys, 'argv', ['admin.py', 'grant', 'test_admin'])
    asyncio.run(console.main())
    assert len(access.admin_ids()) == 1
    monkeypatch.setattr(sys, 'argv', ['admin.py', 'list'])
    asyncio.run(console.main())
    assert 'test_admin' in capsys.readouterr().out
    monkeypatch.setattr(sys, 'argv', ['admin.py', 'revoke', 'test_admin'])
    asyncio.run(console.main())
    assert access.admin_ids() == set()
    asyncio.run(engine.dispose())


def test_race_settings_apply_to_new_rooms(editor):
    from app.game.room_manager import RoomManager
    client, user = editor
    access.write_admin_ids({user.id})
    initial = client.get('/api/admin/world').json()
    initial['world']['race'] = {'countdownSeconds': 120, 'maxPlayers': 2}
    assert client.put('/api/admin/world', json={'world': initial['world'], 'revision': initial['revision']}).status_code == 200
    race = RoomManager().create_race_room()
    assert race.race_countdown == 120 and race.race_max_players == 2
    assert race.lobby_snapshot(0)['maxPlayers'] == 2
