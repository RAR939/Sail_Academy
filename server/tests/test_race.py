import math
import pytest
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


def test_lobby_host_countdown_locks_entry_and_transfers_on_leave():
    import pytest
    manager = RoomManager()
    for user_id in (1, 2, 3):
        manager.add_player(PlayerState(user_id=user_id, username=f'sailor{user_id}'), boat=BoatState(owner_id=user_id))
    room = manager.create_race_room()
    manager.move_player(1, room.room_id)
    manager.move_player(2, room.room_id)
    assert room.lobby_snapshot(100)['phase'] == 'waiting'
    with pytest.raises(ValueError):
        room.start_countdown(2, 100)
    room.start_countdown(1, 100, seconds=30)
    assert room.lobby_snapshot(110)['secondsLeft'] == 20
    assert room.lobby_snapshot(130)['phase'] == 'racing'
    with pytest.raises(ValueError):
        manager.move_player(3, room.room_id)
    assert room.races[1].start_signal_at == room.races[2].start_signal_at == 130
    manager.move_player(1, 'hub')
    assert room.race_host == 2


def test_lobby_shared_signal_time_and_result_order():
    manager = RoomManager()
    for user_id in (1, 2):
        manager.add_player(PlayerState(user_id=user_id, username=f'sailor{user_id}'), boat=BoatState(owner_id=user_id))
    room = manager.create_race_room()
    for user_id in (1, 2): manager.move_player(user_id, room.room_id)
    room.start_countdown(1, 100, seconds=30)
    first, second = room.races[1], room.races[2]
    first.update((-22, -1), (-22, 1), now=135)
    second.update((-18, -1), (-18, 1), now=140)
    assert first.started_at == second.started_at == 130
    first.phase = second.phase = 'finish'
    second.update((12, -1), (12, 1), now=150)
    first.update((12, -1), (12, 1), now=155)
    results = room.lobby_snapshot(155)['players']
    assert [(item['id'], item['elapsed']) for item in results] == [(2, 20), (1, 25)]


@pytest.mark.asyncio
async def test_game_loop_allows_manoeuvring_during_countdown(monkeypatch):
    from app.game import game_loop as loop_module
    from app.game.game_loop import GameLoop
    manager = RoomManager()
    boat = BoatState(owner_id=1)
    manager.add_player(PlayerState(user_id=1, username="sailor"), boat=boat)
    room = manager.create_race_room()
    manager.move_player(1, room.room_id)
    calls = []
    monkeypatch.setattr(loop_module, "room_manager", manager)
    monkeypatch.setattr(loop_module.time, "monotonic", lambda: 100)
    monkeypatch.setattr(loop_module.BoatPhysics, "update", lambda *args: calls.append(True))
    async def no_send(*args): pass
    monkeypatch.setattr(loop_module.manager, "send_room", no_send)
    monkeypatch.setattr(loop_module.manager, "send_personal", no_send)
    loop = GameLoop()
    await loop.update(.05)
    assert not calls
    room.start_countdown(1, 99)
    assert room.race_start_at == 279
    await loop.update(.05)
    assert len(calls) == 1
    assert not room.races[1].start_checked
    assert not room.races[1].individual_recall


def test_individual_recall_only_at_signal_and_recovery():
    race = RaceProgress(start_signal_at=180)
    # Earlier crossing is irrelevant when the boat is fully back before the gun.
    race.apply_start_signal((-22, -4), 0)
    assert not race.individual_recall
    race.update((-22, -1), (-22, 1), now=181)
    assert race.phase == "marks"
    assert race.started_at == 180

    early = RaceProgress(start_signal_at=180)
    early.apply_start_signal((-22, 0.5), 0)
    assert early.individual_recall and early.snapshot(180)["individualRecall"]
    early.update((-22, 1), (-22, 2), now=181)
    assert early.phase == "start" and early.individual_recall
    # Centre has returned, but bow is still over the line: recall remains.
    early.update((-22, 1), (-22, -1), now=182)
    assert early.individual_recall
    early.update((-22, -1), (-22, -3), now=183)
    assert not early.individual_recall and early.phase == "start"
    early.update((-22, -3), (-22, 1), now=184)
    assert early.phase == "marks" and early.started_at == 180


def test_start_signal_uses_hull_and_heading():
    bow_over = RaceProgress()
    bow_over.apply_start_signal((-22, -1), 0)
    assert bow_over.individual_recall
    sideways_clear = RaceProgress()
    sideways_clear.apply_start_signal((-22, -1), math.pi / 2)
    assert not sideways_clear.individual_recall
    course_side = RaceProgress()
    course_side.apply_start_signal((-22, 3), 0)
    assert course_side.individual_recall


def test_start_recall_is_limited_to_start_triangle():
    from app.game.race import hull_in_start_triangle
    assert hull_in_start_triangle((-22, 10), 0)
    assert hull_in_start_triangle((-22, 0), 0)
    assert not hull_in_start_triangle((-55, 10), 0)
    assert not hull_in_start_triangle((10, 10), 0)
    assert not hull_in_start_triangle((-22, 90), 0)
    assert not hull_in_start_triangle((-22, -4), 0)
    for point, expected in [((-22, 10), True), ((10, 10), False), ((-22, 90), False)]:
        race = RaceProgress()
        race.apply_start_signal(point, 0)
        assert race.individual_recall == expected
