from dataclasses import dataclass
import math
import random


@dataclass
class WindState:
    speed: float = 5.0
    direction: float = 0.0
    gust: float = 0.0

    def update(self, delta_time: float):
        self.gust += random.uniform(-0.1, 0.1) * delta_time
        self.gust = max(-1.0, min(1.0, self.gust))

    @property
    def effective_speed(self) -> float:
        return max(0.0, self.speed + self.gust)

    def to_dict(self) -> dict:
        return {
            "speed": self.effective_speed,
            "direction": self.direction,
        }
