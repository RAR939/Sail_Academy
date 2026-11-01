import { AnimationGroup, Color3, Material, Mesh, Observer, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { AssetLoader, type SpawnedAsset } from "./AssetLoader";
import { Nameplate } from "./Nameplate";
const skins = new Set(["skaterMaleA", "skaterFemaleA", "criminalMaleA", "cyborgFemaleA"]);
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
    const asset = await this.loader.spawn("/assets/glb/characters/protagonist.glb", { name: `character-${this.parent.name}`, parent: this.visualRoot, scaling: new Vector3(0.48, 0.48, 0.48) });
    if (this.disposed) { asset.dispose(); return; }
    this.asset = asset; this.material = new StandardMaterial(`skin-${this.parent.name}`, this.scene);
    this.texture = new Texture(`/assets/characters/skins/${skins.has(skin) ? skin : "skaterMaleA"}.png`, this.scene, false, false);
    // All four Kenney skin atlases are fully opaque. Draw both sides because
    // the original character uses open surfaces around joints and clothing.
    this.texture.hasAlpha = false;
    this.material.diffuseTexture = this.texture;
    this.material.alpha = 1;
    this.material.transparencyMode = Material.MATERIAL_OPAQUE;
    this.material.useAlphaFromDiffuseTexture = false;
    this.material.backFaceCulling = false;
    this.material.twoSidedLighting = true;
    this.material.specularColor = Color3.Black();
    for (const root of asset.roots) for (const mesh of root.getChildMeshes()) { mesh.material = this.material; mesh.isPickable = false; }
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
    const clip = state === "walk" ? "run" : state === "jump" ? "jump" : state === "run" ? "run" : "idle";
    const next = this.asset.animations.find(group => group.name.toLowerCase().endsWith(clip));
    if (!next) return;
    const speed = state === "walk" ? 0.55 : 1;
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
