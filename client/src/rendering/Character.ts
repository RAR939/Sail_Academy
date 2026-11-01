import { AnimationGroup, Color3, Material, Mesh, Observer, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { AssetLoader, type SpawnedAsset } from "./AssetLoader";
import { Nameplate } from "./Nameplate";
const models: Record<string, string> = {
  skaterMaleA: "smooth_male_casual", skaterFemaleA: "smooth_female_casual",
  criminalMaleA: "smooth_male_longsleeve", cyborgFemaleA: "smooth_female_tanktop",
  male_shirt: "smooth_male_shirt", male_suit: "smooth_male_suit",
  female_alternative: "smooth_female_alternative", female_dress: "smooth_female_dress",
};
export class Character {
  private asset: SpawnedAsset | null = null;
  private material: StandardMaterial | null = null;
  private texture: Texture | null = null;
  private disposed = false;
  private current = "";
  private active: AnimationGroup | null = null;
  private fading: AnimationGroup | null = null;
  private fadeTime = 0;
  private readonly fadeDuration = 0.16;
  private readonly visualRoot: TransformNode;
  private readonly fadeObserver: Observer<Scene>;
  private readonly label: Nameplate | null;
  constructor(private scene: Scene, private loader: AssetLoader, private parent: TransformNode, name: string | null, subtitle?: string) {
    this.visualRoot = new TransformNode(`character-facing-${parent.name}`, scene);
    this.visualRoot.parent = parent;
    this.visualRoot.position.y = -0.9;
    this.visualRoot.rotation.y = Math.PI;
    this.fadeObserver = scene.onBeforeRenderObservable.add(() => this.updateFade());
    this.label = name ? new Nameplate(scene, name, new Vector3(0, 1.43, 0), subtitle ? 3.0 : 2.2, subtitle ? 0.7 : 0.55, parent, true, subtitle) : null;
  }
  async load(skin: string): Promise<void> {
    const model = models[skin] ?? models.skaterMaleA;
    const asset = await this.loader.spawn(`/assets/glb/characters/quaternius/${model}.glb`, { name: `character-${this.parent.name}`, parent: this.visualRoot, scaling: new Vector3(0.0037, 0.0037, 0.0037) });
    if (this.disposed) { asset.dispose(); return; }
    this.asset = asset;
    for (const root of asset.roots) for (const mesh of root.getChildMeshes()) { mesh.isPickable = false; }
    for (const group of asset.animations) group.stop();
    const next = this.current || "idle"; this.current = ""; this.animate(next);
  }
  getMeshes(): Mesh[] {
    return this.asset?.roots.flatMap(root => root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh)) ?? [];
  }
  animate(state: string): void {
    if (!this.asset) { this.current = state; return; }
    if (this.current === state) return;
    this.current = state;
    const clip = state === "walk" ? "walk" : state === "jump" ? "jump" : state === "run" ? "run" : "idle";
    const next = this.asset.animations.find(group => group.name.toLowerCase().endsWith(clip));
    if (!next) return;
    const speed = 1;
    if (next === this.active) { next.speedRatio = speed; return; }
    if (this.fading) { this.fading.stop(); this.fading = null; }
    this.fading = this.active;
    this.active = next;
    this.fadeTime = 0;
    next.start(clip !== "jump", speed);
    next.setWeightForAllAnimatables(this.fading ? 0 : 1);
    this.fading?.setWeightForAllAnimatables(1);
  }
  private updateFade(): void {
    if (!this.fading || !this.active) return;
    this.fadeTime += Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
    const weight = Math.min(1, this.fadeTime / this.fadeDuration);
    this.active.setWeightForAllAnimatables(weight);
    this.fading.setWeightForAllAnimatables(1 - weight);
    if (weight >= 1) { this.fading.stop(); this.fading = null; }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.scene.onBeforeRenderObservable.remove(this.fadeObserver); this.asset?.dispose(); this.visualRoot.dispose(); this.material?.dispose(); this.texture?.dispose(); this.label?.dispose(); }
}
