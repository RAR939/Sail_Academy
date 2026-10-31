import math

from app.game.boat import BoatState
from app.world.wind import WindState
from app.game.constants import (
    BOAT_MAX_SPEED,
    BOAT_ACCELERATION,
    BOAT_TURN_SPEED,
)


class BoatPhysics:

    @staticmethod
    def update(
        boat: BoatState,
        wind: WindState,
        delta_time: float,
    ):
        if not math.isfinite(delta_time) or delta_time <= 0:
            return

        delta_time = min(delta_time, 0.1)

        # Угол между направлением ветра и курсом лодки.
        relative_angle = abs(
            math.atan2(
                math.sin(wind.direction - boat.heading),
                math.cos(wind.direction - boat.heading),
            )
        )

        # Простая модель эффективности паруса.
        sail_efficiency = abs(math.sin(boat.sail_angle))

        wind_efficiency = max(
            0.0,
            math.sin(relative_angle),
        )

        acceleration = (
            BOAT_ACCELERATION
            * wind.effective_speed / 10.0
            * sail_efficiency
            * wind_efficiency
        )

        # Приближённая скорость лодки.
        boat_speed = math.sqrt(
            boat.vx ** 2 + boat.vz ** 2
        )

        boat_speed += acceleration * delta_time
        boat_speed *= 0.995 ** (delta_time * 60)

        boat_speed = min(boat_speed, BOAT_MAX_SPEED)

        # Направление движения.
        boat.vx = math.sin(boat.heading) * boat_speed
        boat.vz = math.cos(boat.heading) * boat_speed

        boat.x += boat.vx * delta_time
        boat.z += boat.vz * delta_time

        boat.last_update += delta_time
