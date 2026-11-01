"""Authenticated room chat over the same WebSocket used by the game."""
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

os.environ.setdefault('JWT_SECRET', 'chat-test-secret-only-00000000000000000')
from app import main
from app.database.base import Base
from app.database.connection import get_db
from app.game.room_manager import RoomManager, room_manager
from app.websocket import router


@pytest.fixture
def chat_game(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def init():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    async def db():
        async with factory() as session:
            yield session
    monkeypatch.setattr(main, 'init_db', init)
    monkeypatch.setattr(main, 'close_db', engine.dispose)
    monkeypatch.setattr(router, 'AsyncSessionLocal', factory)
    monkeypatch.setattr(room_manager, 'state', RoomManager().state)
    main.app.dependency_overrides[get_db] = db
    try:
        with TestClient(main.app) as client:
            tokens = []
            for username in ('chat_one', 'chat_two', 'chat_three'):
                credentials = {'username': username, 'password': 'test-only-password'}
                assert client.post('/api/auth/register', json=credentials).status_code == 201
                tokens.append(client.post('/api/auth/login', json=credentials).json()['access_token'])
            yield client, tokens
    finally:
        main.app.dependency_overrides.clear()


def receive_until(socket, expected):
    for _ in range(100):
        message = socket.receive_json()
        if message.get('t') == expected:
            return message
    pytest.fail(f'No {expected} message received')


def test_room_delivery_identity_and_isolation(chat_game):
    client, tokens = chat_game
    with client.websocket_connect('/ws/game') as first, client.websocket_connect('/ws/game') as second, client.websocket_connect('/ws/game') as third:
        for socket, token in zip((first, second, third), tokens, strict=True):
            socket.send_json({'t': 'auth', 'token': token})
            receive_until(socket, 'welcome')
        third.send_json({'t': 'enter_location', 'locationId': 'training_area'})
        assert receive_until(third, 'location_changed')['roomType'] == 'training'
        first.send_json({'t': 'chat', 'text': '  Привет, экипаж!  ', 'username': 'подмена', 'user_id': 999})
        own = receive_until(first, 'chat')
        other = receive_until(second, 'chat')
        assert own == other
        assert own['username'] == 'chat_one' and own['user_id'] != 999
        assert own['text'] == 'Привет, экипаж!' and own['roomId'] == 'hub'
        third.send_json({'t': 'ping'})
        for _ in range(100):
            message = third.receive_json()
            assert message['t'] != 'chat', 'Message leaked into a different room'
            if message['t'] == 'pong':
                break
        else:
            pytest.fail('No pong received')


def test_validation_rate_limit_and_authentication(chat_game):
    client, tokens = chat_game
    with client.websocket_connect('/ws/game') as unauthenticated:
        unauthenticated.send_json({'t': 'chat', 'text': 'no auth'})
        with pytest.raises(WebSocketDisconnect):
            unauthenticated.receive_json()
    with client.websocket_connect('/ws/game') as socket:
        socket.send_json({'t': 'auth', 'token': tokens[0]})
        receive_until(socket, 'welcome')
        for text in (' ', 'x' * 401, 123):
            socket.send_json({'t': 'chat', 'text': text})
            assert receive_until(socket, 'chat_error')['message']
        for number in range(router.CHAT_RATE_LIMIT):
            socket.send_json({'t': 'chat', 'text': f'Сообщение {number}'})
            assert receive_until(socket, 'chat')['text'] == f'Сообщение {number}'
        socket.send_json({'t': 'chat', 'text': 'Ещё сообщение'})
        assert 'много' in receive_until(socket, 'chat_error')['message']
        socket.send_json({'t': 'ping'})
        receive_until(socket, 'pong')
