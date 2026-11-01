"""Character selection travels through the actual WebSocket room snapshots."""
import os
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET", "shore-test-secret-only-0000000000000000")
from app import main
from app.database.base import Base
from app.database.connection import get_db
from app.game.room_manager import RoomManager, room_manager
from app.websocket import router


def test_character_selection_and_legacy_auth(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def init():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    async def db():
        async with factory() as session:
            yield session
    monkeypatch.setattr(main, "init_db", init)
    monkeypatch.setattr(main, "close_db", engine.dispose)
    monkeypatch.setattr(router, "AsyncSessionLocal", factory)
    monkeypatch.setattr(room_manager, "state", RoomManager().state)
    main.app.dependency_overrides[get_db] = db
    try:
        with TestClient(main.app) as client:
            tokens = []
            for name in ("sailor_one", "sailor_two"):
                credentials = {"username": name, "password": "test-only-password"}
                assert client.post("/api/auth/register", json=credentials).status_code == 201
                tokens.append(client.post("/api/auth/login", json=credentials).json()["access_token"])
            with client.websocket_connect("/ws/game") as first:
                first.send_json({"t": "auth", "token": tokens[0], "skin": "cyborgFemaleA"})
                welcome = first.receive_json()
                assert welcome["players"][0]["skin"] == "cyborgFemaleA"
                with client.websocket_connect("/ws/game") as second:
                    second.send_json({"t": "auth", "token": tokens[1]})
                    welcome = second.receive_json()
                    assert {p["username"]: p["skin"] for p in welcome["players"]} == {"sailor_one": "cyborgFemaleA", "sailor_two": "skaterMaleA"}
            with client.websocket_connect("/ws/game") as invalid:
                invalid.send_json({"t": "auth", "token": tokens[0], "skin": "invalid"})
                with pytest.raises(WebSocketDisconnect):
                    invalid.receive_json()
    finally:
        main.app.dependency_overrides.clear()
