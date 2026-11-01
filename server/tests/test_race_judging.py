import math

from app.game.boat import BoatState
from app.game.player import PlayerState
from app.game.race import MARKS, RaceProgress
from app.game.race_judging import update_judging
from app.game.room import Room


def make_room():
    room = Room("test", "race", "race_track")
    for uid in (1, 2):
        room.add_player(PlayerState(user_id=uid, username=str(uid)), BoatState(owner_id=uid))
        room.races[uid].phase = "marks"
    room.start_countdown(1, 0)
    room.boats[2].x = 100
    return room


def test_mark_touch_is_one_incident_until_boat_leaves():
    room = make_room()
    boat, progress = room.boats[1], room.races[1]
    boat.x, boat.z = MARKS[0]
    update_judging(room, 0, {})
    update_judging(room, 0, {})
    assert progress.penalty_turns == 1
    boat.x += 10
    update_judging(room, 0, {})
    boat.x -= 10
    update_judging(room, 0, {})
    assert progress.penalty_turns == 2


def test_port_starboard_contact_penalises_only_port_tack():
    room = make_room()
    starboard, port = room.boats[1], room.boats[2]
    starboard.x = port.x = 0
    starboard.z = port.z = 40
    starboard.heading, port.heading = -math.pi/2, math.pi/2
    update_judging(room, 0, {})
    update_judging(room, 0, {})
    assert room.races[1].penalty_turns == 0
    assert room.races[2].penalty_turns == 2


def test_penalty_requires_complete_turns_clear_of_boats_and_blocks_finish():
    race = RaceProgress(phase="finish", started_at=0)
    race.add_penalty(2, "test")
    race.update((12, -1), (12, 1), now=10)
    assert race.phase == "finish"
    heading = 0.2
    for i in range(160):
        previous, heading = heading, heading + math.pi/40
        race.update_penalty(previous, heading, 0, clear=i >= 80)
    assert race.penalty_turns == 1
    for _ in range(80):
        previous, heading = heading, heading + math.pi/40
        race.update_penalty(previous, heading, 0, clear=True)
    assert race.penalty_turns == 0
    race.update((12, -1), (12, 1), now=50)
    assert race.phase == "completed"
