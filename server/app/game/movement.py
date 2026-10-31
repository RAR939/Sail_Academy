import math

from app.game.player import PlayerState
from app.game.constants import (
    PLAYER_MAX_SPEED,
    MOVEMENT_TOLERANCE,
)


class MovementValidator:

    @staticmethod
    def validate_position(
        player: PlayerState,
        x: float,
        y: float,
        z: float,
        delta_time: float,
    ) -> bool:

        values = (x, y, z, delta_time)

        if not all(math.isfinite(value) for value in values):
            return False

        if delta_time <= 0:
            return False

        if delta_time > 1.0:
            return False

        dx = x - player.x
        dy = y - player.y
        dz = z - player.z

        distance = math.sqrt(dx * dx + dy * dy + dz * dz)

        max_distance = (
            PLAYER_MAX_SPEED * delta_time
            + MOVEMENT_TOLERANCE
        )

        return distance <= max_distance
