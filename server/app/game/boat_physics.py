import math

from app.game.boat import BoatState
from app.world.wind import WindState
from app.game.constants import (
    BOAT_MAX_SPEED,
    BOAT_TURN_SPEED,
)


# Approximate teaching polar (true-wind angle in degrees, speed / wind speed).
# The optimal upwind VMG is around 40–46°, not the edge of the no-go zone.
POLAR = ((0, 0.0), (25, 0.0), (30, 0.12), (35, 0.32), (40, 0.50),
         (45, 0.62), (60, 0.75), (90, 0.82), (120, 0.86), (150, 0.74), (180, 0.60))


def polar_factor(angle_radians: float) -> float:
    degrees = max(0.0, min(180.0, math.degrees(angle_radians)))
    for (a0, v0), (a1, v1) in zip(POLAR, POLAR[1:]):
        if degrees <= a1:
            return v0 + (v1 - v0) * (degrees - a0) / (a1 - a0)
    return POLAR[-1][1]


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

        # Ограничиваем скорость поворота на сервере, даже если клиент
        # запрашивает резкое изменение курса.
        turn = math.atan2(math.sin(boat.target_heading - boat.heading), math.cos(boat.target_heading - boat.heading))
        boat.heading += max(-BOAT_TURN_SPEED * delta_time, min(BOAT_TURN_SPEED * delta_time, turn))

        # Угол между направлением ветра и курсом лодки.
        relative_angle = abs(
            math.atan2(
                math.sin(wind.direction - boat.heading),
                math.cos(wind.direction - boat.heading),
            )
        )

        # Учебная поляра с постепенной потерей тяги при приведении к ветру.
        wind_efficiency = polar_factor(relative_angle)
        optimal_trim = max(0.15, min(math.pi / 2, relative_angle / 2))
        trim_error = abs(abs(boat.sail_angle) - optimal_trim)
        sail_efficiency = max(0.25, 1.0 - trim_error / (math.pi / 2))
        target_speed = min(BOAT_MAX_SPEED, wind.effective_speed * wind_efficiency * sail_efficiency)

        # Приближённая скорость лодки.
        boat_speed = math.sqrt(
            boat.vx ** 2 + boat.vz ** 2
        )

        # Inertia: speed approaches the polar target gradually in either direction.
        change = (target_speed - boat_speed) * (1.0 - math.exp(-0.45 * delta_time))
        boat_speed = max(0.0, min(BOAT_MAX_SPEED, boat_speed + change))

        # Направление движения.
        boat.vx = math.sin(boat.heading) * boat_speed
        boat.vz = math.cos(boat.heading) * boat_speed

        boat.x += boat.vx * delta_time
        boat.z += boat.vz * delta_time

        boat.last_update += delta_time
