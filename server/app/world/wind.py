from dataclasses import dataclass, field
import math
import random


@dataclass
class WindState:
    speed: float = 5.0
    direction: float = 0.0
    gust: float = 0.0
    _base_direction: float = field(init=False, repr=False)
    _start_direction: float = field(init=False, repr=False)
    _target_direction: float = field(init=False, repr=False)
    _start_gust: float = field(init=False, repr=False)
    _target_gust: float = field(init=False, repr=False)
    _elapsed: float = field(default=0.0, init=False, repr=False)
    _duration: float = field(default=0.0, init=False, repr=False)

    def __post_init__(self):
        self._base_direction = self.direction
        self._choose_target()

    def _choose_target(self):
        self._start_direction = self.direction
        self._start_gust = self.gust
        self._target_direction = self._base_direction + random.uniform(-math.radians(12), math.radians(12))
        self._target_gust = random.uniform(-2.0, 2.0)
        self._duration = random.uniform(15.0, 30.0)
        self._elapsed = 0.0

    def update(self, delta_time: float):
        if not math.isfinite(delta_time) or delta_time <= 0:
            return
        while delta_time > 0:
            step = min(delta_time, self._duration - self._elapsed)
            self._elapsed += step
            delta_time -= step
            progress = min(1.0, self._elapsed / self._duration)
            smooth = progress * progress * (3.0 - 2.0 * progress)
            self.direction = self._start_direction + (self._target_direction - self._start_direction) * smooth
            self.gust = self._start_gust + (self._target_gust - self._start_gust) * smooth
            if progress >= 1.0:
                self._choose_target()

    @property
    def effective_speed(self) -> float:
        return max(0.0, self.speed + self.gust)

    def to_dict(self) -> dict:
        return {"speed": self.effective_speed, "direction": self.direction}
