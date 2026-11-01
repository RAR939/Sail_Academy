import { Matrix, Scalar, TransformNode, Vector3 } from "@babylonjs/core";

export interface NearbyPlayer { id: number; position: Vector3 }

/** Locally turn an NPC towards its nearest nearby player, without moving its station. */
export class NpcFacing {
  private readonly initialYaw: number;
  private targetId: number | null = null;
  private readonly inverseParent = Matrix.Identity();
  private readonly localTarget = Vector3.Zero();

  constructor(
    private readonly anchor: TransformNode,
    private readonly enterRadius = 4.5,
    private readonly leaveRadius = 5.25,
    private readonly turnSpeed = 5,
  ) {
    this.initialYaw = anchor.rotation.y;
  }

  update(players: readonly NearbyPlayer[], deltaSeconds: number): void {
    const npcPosition = this.anchor.getAbsolutePosition();
    let current: NearbyPlayer | null = null;
    let currentDistance = Infinity;
    let nearest: NearbyPlayer | null = null;
    let nearestDistance = Infinity;
    for (const player of players) {
      const distance = Math.hypot(player.position.x - npcPosition.x, player.position.z - npcPosition.z);
      if (player.id === this.targetId && distance <= this.leaveRadius) {
        current = player;
        currentDistance = distance;
      }
      if (distance <= this.enterRadius && distance < nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    // A small margin prevents two nearby players from making an NPC twitch.
    const target = current && (!nearest || nearestDistance + 0.5 >= currentDistance) ? current : nearest;
    this.targetId = target?.id ?? null;
    let desiredYaw = this.initialYaw;
    if (target) {
      const parent = this.anchor.parent;
      if (parent instanceof TransformNode) {
        parent.computeWorldMatrix(true).invertToRef(this.inverseParent);
        Vector3.TransformCoordinatesToRef(target.position, this.inverseParent, this.localTarget);
      } else {
        this.localTarget.copyFrom(target.position);
      }
      const dx = this.localTarget.x - this.anchor.position.x;
      const dz = this.localTarget.z - this.anchor.position.z;
      // At exactly the same position the direction is undefined; keep the pose.
      desiredYaw = dx * dx + dz * dz < 0.0001 ? this.anchor.rotation.y : Math.atan2(dx, dz);
    }
    const angle = Math.atan2(Math.sin(desiredYaw - this.anchor.rotation.y), Math.cos(desiredYaw - this.anchor.rotation.y));
    const delta = Scalar.Clamp(deltaSeconds, 0, 0.05);
    this.anchor.rotation.y += angle * (1 - Math.exp(-this.turnSpeed * delta));
  }
}
