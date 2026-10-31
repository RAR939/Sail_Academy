from dataclasses import dataclass, field
import time


@dataclass(slots=True)
class BoatState:
    owner_id: int

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

    heading: float = 0.0
    sail_angle: float = 0.0

    vx: float = 0.0
    vz: float = 0.0

    last_update: float = field(default_factory=time.monotonic)

    def update(
        self,
        x: float,
        y: float,
        z: float,
        heading: float,
        sail_angle: float,
    ):
        self.x = x
        self.y = y
        self.z = z

        self.heading = heading
        self.sail_angle = sail_angle

        self.last_update = time.monotonic()

    def to_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "pos": [self.x, self.y, self.z],
            "heading": self.heading,
            "sailAngle": self.sail_angle,
        }
