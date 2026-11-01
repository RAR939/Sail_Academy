import math
from app.game.boat import BoatState
from app.game.boat_physics import BoatPhysics, polar_factor
from app.game.race import RaceProgress, MARKS, MARK_RADIUS, crossed_line, crossed_rounding_gate, rounding_gate, segment_near_mark
from app.game.room_manager import RoomManager
from app.game.player import PlayerState
from app.world.wind import WindState


def test_line_direction_and_bounds():
    assert crossed_line((0, -1), (0, 1), 1)
    assert not crossed_line((0, 1), (0, -1), 1)
    assert not crossed_line((20, -1), (20, 1), 1)
    assert crossed_line((0, 1), (0, -1), -1)


def test_course_order_and_timer():
    race = RaceProgress()
    race.update((-22, -1), (-22, 1), now=100)
    race.update((38, 20), (38, 20), now=101)
    assert race.next_mark == 0
    for index, point in enumerate(MARKS):
        (gx, gz), sign = rounding_gate(index)
        # The course turns left at every mark, so each buoy stays to port.
        assert sign == -1
        before = (point[0] + gx * 8 - gz * sign * 3, point[1] + gz * 8 + gx * sign * 3)
        after = (point[0] + gx * 8 + gz * sign * 3, point[1] + gz * 8 - gx * sign * 3)
        assert crossed_rounding_gate(before, after, index)
        assert not crossed_rounding_gate(after, before, index)
        race.update(before, after, now=102 + index)
        assert race.next_mark == index + 1
    assert race.phase == 'finish'
    race.update((12, 1), (12, -1), now=103)
    assert race.phase == 'finish'
    race.update((12, -1), (12, 1), now=111)
    assert race.phase == 'completed' and race.snapshot(now=999)['elapsed'] == 11
    assert segment_near_mark((0, 80), (40, 80), (20, 80))


def test_separate_start_and_finish_segments():
    race = RaceProgress()
    race.update((12, -1), (12, 1), now=100)
    assert race.phase == 'start'  # Crossed the finish half instead of start.
    race.update((0, -1), (0, 1), now=100)
    assert race.phase == 'start'  # The shared committee-boat endpoint is not a valid crossing.
    race.update((-22, -1), (-22, 1), now=100)
    assert race.phase == 'marks'
    race.phase = 'finish'
    race.update((-22, -1), (-22, 1), now=101)
    assert race.phase == 'finish'  # Crossing the start half is not a finish.
    race.update((12, -1), (12, 1), now=102)
    assert race.phase == 'completed'


def test_buoy_proximity_wrong_side_and_wide_rounding_do_not_count():
    race = RaceProgress(phase="marks")
    point = MARKS[0]
    race.update((point[0]-2, point[1]-2), (point[0]-2, point[1]-2))
    assert race.next_mark == 0
    (gx, gz), sign = rounding_gate(0)
    inbound = (point[0]+gx*8-gz*sign*3, point[1]+gz*8+gx*sign*3)
    outbound = (point[0]+gx*8+gz*sign*3, point[1]+gz*8-gx*sign*3)
    race.update(outbound, inbound)
    assert race.next_mark == 0
    far_in = (point[0]+gx*(MARK_RADIUS+4)-gz*sign*3, point[1]+gz*(MARK_RADIUS+4)+gx*sign*3)
    far_out = (point[0]+gx*(MARK_RADIUS+4)+gz*sign*3, point[1]+gz*(MARK_RADIUS+4)-gx*sign*3)
    race.update(far_in, far_out)
    assert race.next_mark == 0
    race.update(inbound, outbound)
    assert race.next_mark == 1


def test_server_turn_limit_and_wind():
    wind = WindState(speed=5, direction=0)
    boat = BoatState(owner_id=1, heading=0, target_heading=0, sail_angle=0.5)
    for _ in range(20): BoatPhysics.update(boat, wind, 0.05)
    assert boat.x == 0 and boat.z == 0
    boat.target_heading = math.pi
    BoatPhysics.update(boat, wind, 0.1)
    assert abs(boat.heading) <= 0.081
    boat.heading = boat.target_heading = math.pi / 2
    for _ in range(20): BoatPhysics.update(boat, wind, 0.05)
    assert boat.x > 0


def test_upwind_polar_is_smooth_and_40_degrees_is_sailable():
    assert polar_factor(math.radians(20)) == 0
    assert 0 < polar_factor(math.radians(30)) < polar_factor(math.radians(35))
    assert polar_factor(math.radians(40)) > 0
    assert polar_factor(math.radians(45)) > polar_factor(math.radians(40))
    boat = BoatState(owner_id=2, heading=math.radians(40), target_heading=math.radians(40), sail_angle=0.35)
    wind = WindState(speed=5, direction=0)
    for _ in range(20): BoatPhysics.update(boat, wind, 0.05)
    assert math.hypot(boat.vx, boat.vz) > 0


def test_entering_race_resets_boat():
    manager = RoomManager(); boat = BoatState(owner_id=1, x=100, z=100, vx=10)
    manager.add_player(PlayerState(user_id=1, username='sailor'), boat=boat)
    race = manager.create_race_room(); manager.move_player(1, race.room_id)
    assert boat.z == -18 and boat.vx == 0 and boat.sail_angle > 0
    assert race.races[1].phase == 'start'
    manager.move_player(1, 'hub')
    assert race.room_id not in manager.state.rooms
