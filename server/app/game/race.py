"""Server-owned trapezoid training course with directional mark rounding."""
from dataclasses import dataclass, field
import math
import time

# The course is traversed counter-clockwise: keep each mark on the port side.
MARKS = ((-18.0, 80.0), (-70.0, 60.0), (-72.0, -65.0), (8.0, -85.0))
MARK_RADIUS = 18.0
MIN_MARK_DISTANCE = 1.3
START_LINE = ((-45.0, 0.0), (0.0, 0.0))
FINISH_LINE = ((0.0, 0.0), (25.0, 0.0))
START_CENTER = (-22.5, 0.0)
FINISH_CENTER = (12.5, 0.0)


def hull_front_z(z: float, heading: float) -> float:
    """Approximate furthest point of the 4.2 m dinghy along the start-line normal."""
    return z + 2.15 * abs(math.cos(heading)) + 0.68 * abs(math.sin(heading))


def hull_in_start_triangle(position: tuple[float, float], heading: float) -> bool:
    """Intersect the approximate hull with the start-line/first-mark triangle."""
    x, z = position
    forward = (math.sin(heading), math.cos(heading))
    side = (math.cos(heading), -math.sin(heading))
    hull = [
        (x + forward[0] * length + side[0] * width,
         z + forward[1] * length + side[1] * width)
        for length, width in ((-2.15, -.68), (2.15, -.68), (2.15, .68), (-2.15, .68))
    ]
    triangle = (*START_LINE, MARKS[0])
    # Separating-axis test also catches hull edges crossing the triangle when
    # no hull vertex is inside it. Boundaries count as being in the zone.
    for polygon in (hull, triangle):
        for i, point in enumerate(polygon):
            other = polygon[(i + 1) % len(polygon)]
            axis = (-(other[1] - point[1]), other[0] - point[0])
            hull_projection = [p[0] * axis[0] + p[1] * axis[1] for p in hull]
            triangle_projection = [p[0] * axis[0] + p[1] * axis[1] for p in triangle]
            if max(hull_projection) < min(triangle_projection) or max(triangle_projection) < min(hull_projection):
                return False
    return True


def crossed_line(before: tuple[float, float], after: tuple[float, float], direction: int, line_z: float = 0.0, x_min: float = -12.0, x_max: float = 12.0) -> bool:
    x0, z0 = before
    x1, z1 = after
    z0 -= line_z
    z1 -= line_z
    if direction > 0 and not (z0 < 0 <= z1): return False
    if direction < 0 and not (z0 > 0 >= z1): return False
    if z0 == z1: return False
    x = x0 + (x1 - x0) * (-z0 / (z1 - z0))
    return x_min < x < x_max


def segment_near_mark(before: tuple[float, float], after: tuple[float, float], mark: tuple[float, float]) -> bool:
    dx, dz = after[0]-before[0], after[1]-before[1]
    length2 = dx*dx + dz*dz
    t = max(0.0, min(1.0, ((mark[0]-before[0])*dx + (mark[1]-before[1])*dz)/length2)) if length2 else 0.0
    return math.hypot(before[0]+t*dx-mark[0], before[1]+t*dz-mark[1]) <= MARK_RADIUS


def rounding_gate(index: int) -> tuple[tuple[float, float], float]:
    """Outward ray bisecting the course corner and sign of the approach side."""
    mark = MARKS[index]
    previous = MARKS[index-1] if index else START_CENTER
    following = MARKS[index+1] if index+1 < len(MARKS) else FINISH_CENTER
    def unit(point):
        x, z = point[0]-mark[0], point[1]-mark[1]
        distance = math.hypot(x, z)
        return x/distance, z/distance
    incoming, outgoing = unit(previous), unit(following)
    x, z = -(incoming[0]+outgoing[0]), -(incoming[1]+outgoing[1])
    length = math.hypot(x, z)
    if length < 1e-9: raise ValueError("Degenerate course mark")
    gate = x/length, z/length
    approach_sign = math.copysign(1, gate[0]*incoming[1] - gate[1]*incoming[0])
    return gate, approach_sign


def crossed_rounding_gate(before: tuple[float,float], after: tuple[float,float], index: int) -> bool:
    """Cross the finite outside ray from approach side to departure side."""
    mark = MARKS[index]
    gate, sign = rounding_gate(index)
    x0, z0 = before[0]-mark[0], before[1]-mark[1]
    x1, z1 = after[0]-mark[0], after[1]-mark[1]
    c0 = sign * (gate[0]*z0 - gate[1]*x0)
    c1 = sign * (gate[0]*z1 - gate[1]*x1)
    if not (c0 > 0 and c1 <= 0): return False
    t = c0 / (c0-c1)
    x, z = x0+t*(x1-x0), z0+t*(z1-z0)
    distance = gate[0]*x + gate[1]*z
    return MIN_MARK_DISTANCE <= distance <= MARK_RADIUS


@dataclass
class RaceProgress:
    phase: str = "start"
    next_mark: int = 0
    started_at: float | None = None
    finished_in: float | None = None
    mark_approached: bool = False
    start_signal_at: float | None = None
    start_checked: bool = False
    individual_recall: bool = False
    rounding_warning: bool = False
    penalty_turns: int = 0
    penalty_reason: str = ""
    penalty_angle: float = 0.0
    penalty_tack: bool = False
    penalty_gybe: bool = False
    touching_marks: set = field(default_factory=set, repr=False)

    def add_penalty(self, turns: int, reason: str):
        self.penalty_turns += turns
        self.penalty_reason = reason
        self.penalty_angle = 0.0
        self.penalty_tack = self.penalty_gybe = False

    def update_penalty(self, before: float, after: float, wind: float, clear: bool):
        if not self.penalty_turns:
            return
        if not clear:
            self.penalty_angle = 0.0
            self.penalty_tack = self.penalty_gybe = False
            return
        turn = math.atan2(math.sin(after-before), math.cos(after-before))
        if abs(turn) < 1e-8:
            return
        if self.penalty_angle * turn < -1e-8:
            self.penalty_angle = 0.0
            self.penalty_tack = self.penalty_gybe = False
        old_rel = math.atan2(math.sin(before-wind), math.cos(before-wind))
        new_rel = math.atan2(math.sin(after-wind), math.cos(after-wind))
        if old_rel * new_rel <= 0 and abs(old_rel-new_rel) < math.pi:
            self.penalty_tack = True
        if abs(old_rel-new_rel) > math.pi:
            self.penalty_gybe = True
        self.penalty_angle += turn
        if abs(self.penalty_angle) >= 2*math.pi - 0.02 and self.penalty_tack and self.penalty_gybe:
            self.penalty_turns -= 1
            self.penalty_angle = 0.0
            self.penalty_tack = self.penalty_gybe = False
            if not self.penalty_turns:
                self.penalty_reason = ""

    def apply_start_signal(self, position: tuple[float, float], heading: float) -> None:
        if self.start_checked:
            return
        self.start_checked = True
        self.individual_recall = hull_in_start_triangle(position, heading)

    def update(self, before: tuple[float,float], after: tuple[float,float], now: float | None = None, heading: float = 0.0):
        now = time.monotonic() if now is None else now
        if self.phase == "start" and self.individual_recall:
            if hull_front_z(after[1], heading) < 0:
                self.individual_recall = False
            return
        if self.phase == "start" and crossed_line(before, after, 1, 0.0, START_LINE[0][0], START_LINE[1][0]):
            self.phase = "marks"; self.started_at = self.start_signal_at if self.start_signal_at is not None else now
        elif self.phase == "marks":
            mark = MARKS[self.next_mark]
            gate, sign = rounding_gate(self.next_mark)
            cross_before = sign*(gate[0]*(before[1]-mark[1])-gate[1]*(before[0]-mark[0]))
            if cross_before > 0 and segment_near_mark(before, after, mark):
                self.mark_approached = True
            if self.mark_approached and crossed_rounding_gate(before, after, self.next_mark):
                self.next_mark += 1
                self.mark_approached = False
                self.rounding_warning = False
                if self.next_mark == len(MARKS): self.phase = "finish"
            elif crossed_rounding_gate(after, before, self.next_mark):
                self.rounding_warning = True
            elif math.hypot(after[0]-mark[0], after[1]-mark[1]) > MARK_RADIUS*2:
                self.mark_approached = False
        elif self.phase == "finish" and not self.penalty_turns and crossed_line(before, after, 1, 0.0, FINISH_LINE[0][0], FINISH_LINE[1][0]):
            self.phase = "completed"
            self.finished_in = max(0.0, now - self.started_at) if self.started_at is not None else 0.0

    def snapshot(self, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        clock_start = self.started_at if self.started_at is not None else self.start_signal_at
        elapsed = self.finished_in if self.finished_in is not None else (max(0.0, now-clock_start) if clock_start is not None else 0.0)
        gate = rounding_gate(self.next_mark)[0] if self.phase == "marks" else None
        return {"phase":self.phase, "nextMark":self.next_mark, "elapsed":round(elapsed,2), "marks":[list(m) for m in MARKS], "markRadius":MARK_RADIUS, "startLine":[list(p) for p in START_LINE], "finishLine":[list(p) for p in FINISH_LINE], "markSide":"port", "roundingGate":list(gate) if gate else None, "markApproached":self.mark_approached, "individualRecall":self.individual_recall, "roundingWarning": self.rounding_warning, "penaltyTurns": self.penalty_turns, "penaltyReason": self.penalty_reason, "penaltyProgress": min(1.0, abs(self.penalty_angle)/(2*math.pi))}
