import math
from unittest.mock import patch

from app.world.wind import WindState


def test_wind_changes_smoothly_and_stays_near_initial_conditions():
    with patch("app.world.wind.random.uniform", side_effect=lambda low, high: high):
        wind = WindState(speed=5.0, direction=1.0)
        wind.update(15.0)
        assert math.isclose(wind.direction, 1.0 + math.radians(6))
        assert math.isclose(wind.effective_speed, 6.0)
        wind.update(45.0)
        assert math.isclose(wind.direction, 1.0 + math.radians(12))
        assert math.isclose(wind.effective_speed, 7.0)
        assert wind.to_dict() == {"speed": wind.effective_speed, "direction": wind.direction}


def test_wind_ignores_invalid_elapsed_time_and_speed_cannot_be_negative():
    wind = WindState(speed=0.0, gust=-0.5)
    before = wind.to_dict()
    for elapsed in (-1.0, 0.0, math.nan, math.inf):
        wind.update(elapsed)
        assert wind.to_dict() == before
    assert wind.effective_speed == 0.0
