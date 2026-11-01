import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { AssetLoader } from "../rendering/AssetLoader";
import { Character } from "../rendering/Character";
import type { NearbyPlayer } from "./NpcFacing";

type Walker = { anchor: TransformNode; character: Character; from: Vector3; to: Vector3; progress: number; direction: number; length: number };

/** Background visitors follow simple routes without the dialogue service. */
export class AmbientCrowd {
  private readonly walkers: Walker[] = [];
  private disposed = false;
  public get visitors(): readonly Walker[] { return this.walkers; }
  constructor(scene: Scene, loader: AssetLoader, parent: TransformNode) {
    const routes: Array<[number, number, number, number, string]> = [
      [-17, 8, -13, 13, "skaterFemaleA"], [5, 18, 11, 18, "skaterMaleA"],
      [19, 10, 23, 13, "cyborgFemaleA"], [-18, -3, -15, -7, "criminalMaleA"],
      [1, -8, 5, -10, "skaterMaleA"], [10, -3, 14, -5, "skaterFemaleA"],
      [-5, 18, -1, 18, "criminalMaleA"], [20, 20, 23, 17, "cyborgFemaleA"],
    ];
    routes.forEach(([x1, z1, x2, z2, skin], index) => {
      const anchor = new TransformNode(`visitor-${index}`, scene); anchor.parent = parent;
      const from = new Vector3(x1, .9, z1), to = new Vector3(x2, .9, z2);
      const character = new Character(scene, loader, anchor, null);
      this.walkers.push({ anchor, character, from, to, progress: (index % 3) / 3, direction: 1, length: Vector3.Distance(from, to) });
      void character.load(skin).catch(error => { if (!this.disposed) console.warn("Не удалось загрузить посетителя", error); });
    });
  }
  update(delta: number, players: readonly NearbyPlayer[]): void {
    for (const walker of this.walkers) {
      const p = walker.anchor.position;
      const player = players.find(other => Math.hypot(other.position.x - p.x, other.position.z - p.z) < 2.2);
      if (player) {
        walker.character.animate("idle");
        const dx = player.position.x - p.x, dz = player.position.z - p.z;
        if (dx * dx + dz * dz > .01) walker.anchor.rotation.y = Math.atan2(dx, dz);
      } else {
        walker.progress += walker.direction * Math.min(delta, .05) * .65 / walker.length;
        if (walker.progress >= 1) { walker.progress = 1; walker.direction = -1; }
        if (walker.progress <= 0) { walker.progress = 0; walker.direction = 1; }
        walker.anchor.rotation.y = Math.atan2((walker.to.x - walker.from.x) * walker.direction, (walker.to.z - walker.from.z) * walker.direction);
        walker.character.animate("walk");
      }
      Vector3.LerpToRef(walker.from, walker.to, walker.progress, p);
    }
  }
  dispose(): void { this.disposed = true; for (const walker of this.walkers) { walker.character.dispose(); walker.anchor.dispose(); } }
}
