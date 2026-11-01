"""Simplified training umpire, evaluated from server-owned boat positions."""
import math

from app.game.race import MARKS, START_LINE, FINISH_LINE

HULL_HALF_LENGTH = 2.15
HULL_HALF_WIDTH = 0.68
MARK_OBJECT_RADIUS = 0.9
PENALTY_CLEARANCE = 8.0


def touches_mark(boat, mark):
    dx, dz = mark[0] - boat.x, mark[1] - boat.z
    forward = dx * math.sin(boat.heading) + dz * math.cos(boat.heading)
    side = dx * math.cos(boat.heading) - dz * math.sin(boat.heading)
    outside_forward = max(abs(forward) - HULL_HALF_LENGTH, 0.0)
    outside_side = max(abs(side) - HULL_HALF_WIDTH, 0.0)
    return math.hypot(outside_forward, outside_side) <= MARK_OBJECT_RADIUS


def boats_touch(a, b):
    delta = (b.x - a.x, b.z - a.z)
    def axes(boat):
        return ((math.sin(boat.heading), math.cos(boat.heading)),
                (math.cos(boat.heading), -math.sin(boat.heading)))
    axes_a, axes_b = axes(a), axes(b)
    for axis in (*axes_a, *axes_b):
        def radius(boat_axes):
            return (HULL_HALF_LENGTH * abs(sum(x*y for x, y in zip(axis, boat_axes[0]))) +
                    HULL_HALF_WIDTH * abs(sum(x*y for x, y in zip(axis, boat_axes[1]))))
        if abs(sum(x*y for x, y in zip(axis, delta))) > radius(axes_a) + radius(axes_b):
            return False
    return True


def tack(boat, wind_direction):
    side = math.sin(wind_direction - boat.heading)
    # At head-to-wind or dead downwind the tack is ambiguous.
    return 0 if abs(side) < 0.15 else (1 if side > 0 else -1)


def update_judging(room, wind_direction, previous_headings):
    if room.race_start_at is None:
        return
    boats = list(room.boats.items())
    for user_id, boat in boats:
        race = room.races.get(user_id)
        if not race or race.phase == "completed":
            continue
        marks = [START_LINE[0], START_LINE[1]] if race.phase == "start" else (
            [MARKS[race.next_mark - 1] if race.next_mark else START_LINE[0], MARKS[race.next_mark]] if race.phase == "marks"
            else [MARKS[-1], *FINISH_LINE])
        contact = {mark for mark in marks if touches_mark(boat, mark)}
        if contact - race.touching_marks:
            race.add_penalty(1, "Касание знака: правило 31")
        race.touching_marks = contact
        clear = all(other_id == user_id or math.hypot(boat.x-other.x, boat.z-other.z) >= PENALTY_CLEARANCE for other_id, other in boats)
        if not clear or math.hypot(boat.vx, boat.vz) >= 0.2:
            race.update_penalty(previous_headings.get(user_id, boat.heading), boat.heading, wind_direction, clear)

    contacts = set()
    for index, (id_a, a) in enumerate(boats):
        for id_b, b in boats[index+1:]:
            if not boats_touch(a, b):
                continue
            pair = tuple(sorted((id_a, id_b)))
            contacts.add(pair)
            if pair in room.boat_contacts:
                continue
            tack_a, tack_b = tack(a, wind_direction), tack(b, wind_direction)
            if tack_a * tack_b != -1:
                continue
            # Positive sine means wind from starboard in this coordinate system.
            offender = id_b if tack_a > 0 else id_a
            race = room.races.get(offender)
            if race and race.phase != "completed":
                race.add_penalty(2, "Контакт на левом галсе с лодкой правого галса: правило 10 (учебное определение)")
    room.boat_contacts = contacts
