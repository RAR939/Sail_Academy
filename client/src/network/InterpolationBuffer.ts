import type { PlayerStateMessage } from "./NetworkMessages";

interface TimedPlayerSnapshot {
  receivedAt: number;
  state: PlayerStateMessage;
}

export class InterpolationBuffer {
  private readonly snapshots: TimedPlayerSnapshot[] = [];
  private readonly interpolationDelayMs = 180;
  private readonly maxSnapshots = 20;

  public push(state: PlayerStateMessage, receivedAt: number): void {
    const last = this.snapshots[this.snapshots.length - 1];

    if (last && receivedAt <= last.receivedAt) {
      return;
    }

    this.snapshots.push({
      receivedAt,
      state: { ...state },
    });

    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  public sample(now: number): PlayerStateMessage | null {
    if (this.snapshots.length === 0) {
      return null;
    }

    if (this.snapshots.length === 1) {
      return this.snapshots[0]!.state;
    }

    const targetTime = now - this.interpolationDelayMs;

    if (targetTime <= this.snapshots[0]!.receivedAt) {
      return this.snapshots[0]!.state;
    }

    for (let index = 0; index < this.snapshots.length - 1; index += 1) {
      const from = this.snapshots[index]!;
      const to = this.snapshots[index + 1]!;

      if (targetTime > to.receivedAt) {
        continue;
      }

      const duration = to.receivedAt - from.receivedAt;
      const amount = duration <= 0
        ? 1
        : Math.max(0, Math.min(1, (targetTime - from.receivedAt) / duration));

      return {
        ...to.state,
        x: from.state.x + (to.state.x - from.state.x) * amount,
        y: from.state.y + (to.state.y - from.state.y) * amount,
        z: from.state.z + (to.state.z - from.state.z) * amount,
        ry: interpolateAngle(from.state.ry, to.state.ry, amount),
      };
    }

    return this.snapshots[this.snapshots.length - 1]!.state;
  }
}

function interpolateAngle(from: number, to: number, amount: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * amount;
}
