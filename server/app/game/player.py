from dataclasses import dataclass, field
import time


@dataclass(slots=True)
class PlayerState:
    user_id: int
    username: str

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

    ry: float = 0.0
    anim: str = "idle"

    last_update: float = field(default_factory=time.monotonic)

    def update_position(
        self,
        x: float,
        y: float,
        z: float,
        ry: float,
        anim: str | None = None,
    ):
        self.x = x
        self.y = y
        self.z = z
        self.ry = ry

        if anim is not None:
            self.anim = anim

        self.last_update = time.monotonic()

    def to_dict(self) -> dict:
        return {
            "id": self.user_id,
            "username": self.username,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "ry": self.ry,
            "anim": self.anim,
        }
