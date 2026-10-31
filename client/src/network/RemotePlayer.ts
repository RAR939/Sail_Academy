import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { PlayerStateMessage } from "./NetworkMessages";
import { InterpolationBuffer } from "./InterpolationBuffer";

export class RemotePlayer {
  private readonly mesh: Mesh;
  private readonly interpolation = new InterpolationBuffer();

  public constructor(
    scene: Scene,
    initialState: PlayerStateMessage,
  ) {
    this.mesh = MeshBuilder.CreateCapsule(
      `remote-player-${initialState.id}`,
      {
        height: 1.8,
        radius: 0.35,
        tessellation: 12,
      },
      scene,
    );

    this.mesh.isPickable = false;
    this.mesh.checkCollisions = false;

    const material = new StandardMaterial(
      `remote-player-material-${initialState.id}`,
      scene,
    );
    material.diffuseColor = Color3.FromHSV(
      (initialState.id * 47) % 360,
      0.58,
      0.92,
    );
    this.mesh.material = material;

    this.pushSnapshot(initialState);
    this.update(performance.now());
  }

  public pushSnapshot(state: PlayerStateMessage): void {
    this.interpolation.push(state, performance.now());
  }

  public update(now: number): void {
    const state = this.interpolation.sample(now);
    if (!state) {
      return;
    }

    this.mesh.position.set(
      state.x,
      state.y + 1.1,
      state.z,
    );
    this.mesh.rotation.y = state.ry;
  }

  public dispose(): void {
    this.mesh.dispose(false, true);
  }
}
