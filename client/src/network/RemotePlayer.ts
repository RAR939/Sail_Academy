import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import type { PlayerStateMessage } from "./NetworkMessages";
import { InterpolationBuffer } from "./InterpolationBuffer";
import { AssetLoader } from "../rendering/AssetLoader";
import { Character } from "../rendering/Character";
export class RemotePlayer {
  private readonly mesh: Mesh;
  private readonly interpolation = new InterpolationBuffer();
  private readonly character: Character;
  constructor(scene: Scene, initialState: PlayerStateMessage, loader: AssetLoader) {
    this.mesh = MeshBuilder.CreateBox(`remote-player-${initialState.id}`, { size: 0.01 }, scene);
    this.mesh.isVisible = false; this.mesh.isPickable = false;
    this.character = new Character(scene, loader, this.mesh, initialState.username);
    void this.character.load(initialState.skin ?? "skaterMaleA").catch(error => console.error("Не удалось загрузить персонажа", error));
    this.pushSnapshot(initialState); this.update(performance.now());
  }
  public get position(): Vector3 { return this.mesh.position; }
  public pushSnapshot(state: PlayerStateMessage): void { this.interpolation.push(state, performance.now()); }
  public update(now: number): void {
    const state = this.interpolation.sample(now); if (!state) return;
    this.mesh.position.set(state.x, state.y + 1.1, state.z); this.mesh.rotation.y = state.ry; this.character.animate(state.anim);
  }
  public dispose(): void { this.character.dispose(); this.mesh.dispose(); }
}
