"""Exercise the real HTTP/auth/SQLite flow without touching the working database."""
import asyncio
import json
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET", "shore-test-secret-only-0000000000000000")

from app.ai import service
from app.api import shore
from app.database.base import Base
from app.database.connection import get_db
from app.game.player import PlayerState
from app.game.room_manager import RoomManager, room_manager
from app import main


@pytest.fixture
def game(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def init():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def db():
        async with factory() as session:
            yield session

    def unavailable(messages):
        raise OSError("No model installed")

    monkeypatch.setattr(main, "init_db", init)
    monkeypatch.setattr(main, "close_db", engine.dispose)
    monkeypatch.setattr(room_manager, "state", RoomManager().state)
    monkeypatch.setattr(service, "generate_local", unavailable)
    # Each TestClient owns a fresh event loop.
    monkeypatch.setattr(shore, "story_lock", asyncio.Lock())
    monkeypatch.setattr(shore, "dialogue_lock", asyncio.Lock())
    monkeypatch.setattr(service, "generation_lock", asyncio.Lock())
    main.app.dependency_overrides[get_db] = db
    try:
        with TestClient(main.app) as client:
            credentials = {"username": "shore_tester", "password": "test-only-password"}
            registered = client.post("/api/auth/register", json=credentials)
            assert registered.status_code == 201
            user_id = registered.json()["id"]
            token = client.post("/api/auth/login", json=credentials).json()["access_token"]
            client.headers["Authorization"] = f"Bearer {token}"
            player = PlayerState(user_id=user_id, username=credentials["username"])
            room_manager.add_player(player, "hub")
            yield client, player
    finally:
        main.app.dependency_overrides.clear()


def talk(client, player, npc_id):
    player.x, player.z = shore.NPCS[npc_id]["position"]
    response = client.post("/api/ai/dialog", json={"npc_id": npc_id, "text": "Здравствуйте!"})
    assert response.status_code == 200, response.text
    return response.json()


def test_full_route_and_persistent_progress(game):
    client, player = game
    assert client.get("/api/story").json()["step"] == "meet_captain"
    assert talk(client, player, "captain")["story"]["step"] == "weather"
    assert talk(client, player, "weather")["story"]["step"] == "vest"
    player.x, player.z = 15, 5
    response = client.post("/api/story/interact", json={"target": "vest"})
    assert response.json()["story"]["has_vest"] is True
    assert response.json()["story"]["step"] == "rules"
    assert talk(client, player, "judge")["story"]["step"] == "pier"
    player.x, player.z = -14, -26
    assert client.post("/api/story/interact", json={"target": "pier"}).json()["story"]["step"] == "debrief"
    assert talk(client, player, "captain")["story"]["completed"] is True
    # A new HTTP/database session and a fresh in-memory player keep the saved lesson.
    room_manager.remove_player(player.user_id)
    room_manager.add_player(PlayerState(user_id=player.user_id, username="shore_tester"), "hub")
    assert client.get("/api/story").json()["completed"] is True


def test_no_skipping_or_remote_interactions(game):
    client, player = game
    assert client.post("/api/story/interact", json={"target": "vest"}).status_code == 409
    player.x, player.z = 15, 5
    assert client.post("/api/story/interact", json={"target": "vest"}).json()["story"]["index"] == 0
    assert talk(client, player, "judge")["story"]["index"] == 0
    assert client.post("/api/ai/dialog", json={"npc_id": "unknown", "text": "test"}).status_code == 404
    assert client.post("/api/ai/dialog", json={"npc_id": "judge", "text": "   "}).status_code == 422
    assert client.get("/api/story", headers={"Authorization": "Bearer invalid"}).status_code == 401


def test_serves_built_client_and_local_models(game):
    client, _ = game
    assert main.CLIENT_DIR == main.BASE_DIR / "client" / "dist"
    if (main.CLIENT_DIR / "index.html").exists():
        response = client.get("/")
        assert response.status_code == 200
        assert 'id="renderCanvas"' in response.text
        assert client.get("/assets/glb/environment/tree_palm_tall.glb").status_code == 200
        assert client.get("/seascape.png").status_code == 200
        assert client.get("/assets/glb/props/Textures/colormap.png").status_code == 200


def test_fallback_and_personal_memory(game):
    client, player = game
    first = talk(client, player, "sailor")
    assert first["backend"] == "fallback"
    assert "швартов" in first["text"].lower()
    second = talk(client, player, "sailor")
    assert "уже это обсуждали" in second["text"]
    # Another user's memory and scenario are independent.
    credentials = {"username": "another_tester", "password": "test-only-password"}
    user_id = client.post("/api/auth/register", json=credentials).json()["id"]
    client.headers["Authorization"] = "Bearer " + client.post("/api/auth/login", json=credentials).json()["access_token"]
    other = PlayerState(user_id=user_id, username="another_tester")
    room_manager.add_player(other, "hub")
    assert "уже это обсуждали" not in talk(client, other, "sailor")["text"]


def test_ollama_connector_and_context(game, monkeypatch):
    client, player = game
    captured = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, size):
            return json.dumps({"message": {"content": "Румпель управляет рулём."}}).encode()

    def urlopen(request, timeout):
        assert request.full_url.endswith("/api/chat")
        payload = json.loads(request.data)
        assert payload["stream"] is False
        captured.append(payload)
        return Response()

    monkeypatch.setattr(service, "generate_local", ORIGINAL_GENERATE)
    monkeypatch.setattr(service.urllib.request, "urlopen", urlopen)
    reply = talk(client, player, "captain")
    assert reply["backend"] == "ollama"
    assert reply["text"] == "Румпель управляет рулём."
    assert reply["story"]["step"] == "weather"
    talk(client, player, "captain")
    assert any(message["role"] == "assistant" for message in captured[-1]["messages"])


ORIGINAL_GENERATE = service.generate_local
