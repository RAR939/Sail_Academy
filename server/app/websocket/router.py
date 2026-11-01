import asyncio
import logging
import math
import time

import jwt

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.database.connection import AsyncSessionLocal
from app.database.models import User
from app.security.tokens import decode_access_token

from app.game.player import PlayerState
from app.game.boat import BoatState
from app.game.room_manager import room_manager

from app.websocket.manager import manager
from app.admin import world as world_config


logger = logging.getLogger(__name__)
router = APIRouter()

PLAYER_MAX_SPEED = 4.0
PLAYER_MAX_VERTICAL_SPEED = 3.0
MOVEMENT_TOLERANCE = 0.5


def get_message_type(message: dict):
    return message.get("t", message.get("type"))


def is_valid_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_player_movement(
    player: PlayerState,
    x: float,
    y: float,
    z: float,
    now: float
) -> bool:
    elapsed = min(now - player.last_update, 0.5)

    if elapsed <= 0:
        return False

    dx = x - player.x
    dy = y - player.y
    dz = z - player.z

    horizontal_distance = math.sqrt(dx * dx + dz * dz)
    vertical_distance = abs(dy)

    max_horizontal = world_config.read()[0].player.runSpeed * elapsed + MOVEMENT_TOLERANCE
    max_vertical = PLAYER_MAX_VERTICAL_SPEED * elapsed + MOVEMENT_TOLERANCE

    return (
        horizontal_distance <= max_horizontal
        and vertical_distance <= max_vertical
    )


async def send_room_state(user_id: int):
    room = room_manager.get_player_room(user_id)

    if room is None:
        return

    await manager.send_room(
        room,
        {
            "t": "players",
            "delta": room.get_players()
        }
    )


async def enter_room(
    websocket: WebSocket,
    user_id: int,
    room_id: str
):
    try:
        room_manager.move_player(user_id, room_id)

    except KeyError:
        await websocket.send_json({
            "t": "error",
            "message": "Room not found"
        })
        return

    except ValueError as error:
        await websocket.send_json({
            "t": "error",
            "message": str(error)
        })
        return

    room = room_manager.get_player_room(user_id)

    await websocket.send_json({
        "t": "location_changed",
        "roomId": room.room_id,
        "roomType": room.room_type,
        "locationId": room.location_id,
        "players": room.get_players()
    })

    await send_room_state(user_id)

    logger.info(
        "User %s entered room %s",
        user_id,
        room.room_id
    )


@router.websocket("/ws/game")
async def game_websocket(websocket: WebSocket):
    user_id = None
    authenticated = False

    await websocket.accept()

    try:
        # Авторизация в течение трёх секунд.
        try:
            auth_message = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=3.0
            )
        except asyncio.TimeoutError:
            await websocket.close(
                code=1008,
                reason="Authentication timeout"
            )
            return

        if not isinstance(auth_message, dict):
            await websocket.close(
                code=1008,
                reason="Invalid auth message"
            )
            return

        if get_message_type(auth_message) != "auth":
            await websocket.close(
                code=1008,
                reason="Authentication required"
            )
            return

        token = auth_message.get("token")

        if not isinstance(token, str):
            await websocket.close(
                code=1008,
                reason="Invalid token"
            )
            return

        try:
            user_id = decode_access_token(token)

        except (
            jwt.InvalidTokenError,
            ValueError,
            TypeError,
            AttributeError
        ):
            await websocket.close(
                code=1008,
                reason="Invalid token"
            )
            return

        # Проверяем пользователя.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(User).where(User.id == user_id)
            )

            user = result.scalar_one_or_none()

            if user is None or not user.is_active:
                await websocket.close(
                    code=1008,
                    reason="User not found"
                )
                return

            username = user.username

        skin = auth_message.get("skin", "skaterMaleA")
        if skin not in ("skaterMaleA", "skaterFemaleA", "criminalMaleA", "cyborgFemaleA"):
            await websocket.close(code=1008, reason="Invalid skin")
            return

        # Создаём персонажа и лодку.
        player = PlayerState(
            user_id=user_id,
            username=username,
            skin=skin
        )

        boat = BoatState(
            owner_id=user_id
        )

        room_manager.add_player(
            player=player,
            room_id="hub",
            boat=boat
        )

        await manager.connect(user_id, websocket)
        authenticated = True

        room = room_manager.get_player_room(user_id)

        await websocket.send_json({
            "t": "welcome",
            "user_id": user_id,
            "username": username,
            "room": room.room_id,
            "players": room.get_players()
        })

        await send_room_state(user_id)

        logger.info(
            "User %s connected",
            user_id
        )

        # Основной цикл обработки сообщений.
        while True:
            message = await websocket.receive_json()

            if not isinstance(message, dict):
                await websocket.send_json({
                    "t": "error",
                    "message": "Message must be a JSON object"
                })
                continue

            message_type = get_message_type(message)

            player = room_manager.get_player(user_id)

            if player is None:
                break

            # ---------------------------------
            # PING
            # ---------------------------------

            if message_type == "ping":
                await websocket.send_json({
                    "t": "pong"
                })

            # ---------------------------------
            # MOVEMENT
            # ---------------------------------

            elif message_type == "move":
                x = message.get("x")
                y = message.get("y")
                z = message.get("z")
                ry = message.get("ry", 0.0)
                anim = message.get("anim")

                if not all(
                    is_valid_number(value)
                    for value in (x, y, z, ry)
                ):
                    await websocket.send_json({
                        "t": "error",
                        "message": "Invalid movement values"
                    })
                    continue

                if anim is not None and (
                    not isinstance(anim, str) or len(anim) > 24
                ):
                    await websocket.send_json({
                        "t": "error",
                        "message": "Invalid animation"
                    })
                    continue

                if not validate_player_movement(
                    player,
                    float(x),
                    float(y),
                    float(z),
                    time.monotonic()
                ):
                    await websocket.send_json({
                        "t": "error",
                        "message": "Movement speed limit exceeded"
                    })
                    continue

                player.update_position(
                    x=float(x),
                    y=float(y),
                    z=float(z),
                    ry=float(ry),
                    anim=anim
                )

            # ---------------------------------
            # BOAT CONTROL
            # ---------------------------------

            elif message_type == "boat":
                room = room_manager.get_player_room(user_id)
                boat = room.get_boat(user_id) if room else None

                if boat is None:
                    await websocket.send_json({
                        "t": "error",
                        "message": "Boat not found"
                    })
                    continue

                heading = message.get("heading")
                sail_angle = message.get("sailAngle")

                if (
                    not is_valid_number(heading)
                    or not is_valid_number(sail_angle)
                ):
                    await websocket.send_json({
                        "t": "error",
                        "message": "Invalid boat controls"
                    })
                    continue

                if abs(sail_angle) > math.pi:
                    await websocket.send_json({
                        "t": "error",
                        "message": "Invalid sail angle"
                    })
                    continue

                boat.heading = math.atan2(
                    math.sin(heading),
                    math.cos(heading)
                )

                boat.sail_angle = float(sail_angle)

            # ---------------------------------
            # CREATE RACE
            # ---------------------------------

            elif message_type == "create_race":
                current_room = room_manager.get_player_room(user_id)

                if current_room is None:
                    continue

                if current_room.room_type == "race":
                    await websocket.send_json({
                        "t": "error",
                        "message": "You are already in a race"
                    })
                    continue

                race_room = room_manager.create_race_room()

                await enter_room(
                    websocket,
                    user_id,
                    race_room.room_id
                )

                await websocket.send_json({
                    "t": "race_created",
                    "roomId": race_room.room_id
                })

            # ---------------------------------
            # ENTER LOCATION
            # ---------------------------------

            elif message_type == "enter_location":
                location_id = message.get("locationId")
                room_id = message.get("roomId")

                if location_id == "club":
                    target_room_id = "hub"

                elif location_id == "training_area":
                    training_room = room_manager.get_or_create_training_room(
                        "training_area"
                    )
                    target_room_id = training_room.room_id

                elif location_id == "race_track":
                    if not isinstance(room_id, str):
                        await websocket.send_json({
                            "t": "error",
                            "message": "Race room ID is required"
                        })
                        continue

                    try:
                        target_room = room_manager.get_room(room_id)
                    except KeyError:
                        await websocket.send_json({
                            "t": "error",
                            "message": "Race room not found"
                        })
                        continue

                    if target_room.room_type != "race":
                        await websocket.send_json({
                            "t": "error",
                            "message": "Invalid race room"
                        })
                        continue

                    target_room_id = target_room.room_id

                else:
                    await websocket.send_json({
                        "t": "error",
                        "message": "Unknown location"
                    })
                    continue

                await enter_room(
                    websocket,
                    user_id,
                    target_room_id
                )

            # ---------------------------------
            # UNKNOWN MESSAGE
            # ---------------------------------

            else:
                await websocket.send_json({
                    "t": "error",
                    "message": f"Unsupported message type: {message_type}"
                })

    except WebSocketDisconnect:
        logger.info(
            "User %s disconnected",
            user_id
        )

    except Exception:
        logger.exception(
            "WebSocket error for user %s",
            user_id
        )

    finally:
        if authenticated and user_id is not None:
            manager.disconnect(user_id, websocket)

            if not manager.is_connected(user_id):
                room_manager.remove_player(user_id)

                logger.info(
                    "User %s removed from game",
                    user_id
                )
