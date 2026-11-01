import { Color3, DynamicTexture, MeshBuilder, Scene, StandardMaterial, TransformNode } from "@babylonjs/core";

/** A small life jacket built from padded panels, reflective strips and webbing. */
export class LifeJacket {
  private readonly root: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly texture: DynamicTexture;

  constructor(scene: Scene, parent: TransformNode) {
    this.root = new TransformNode("life-jacket", scene);
    this.root.parent = parent;
    this.root.position.y = -0.10;
    this.root.position.z = 0.04;
    this.root.scaling.setAll(0.82);
    this.texture = new DynamicTexture("life-jacket-fabric", { width: 256, height: 256 }, scene, true);
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#ed741c"; ctx.fillRect(0, 0, 256, 256);
    // Fine repeating weave, seams and shaded padding are independent of image downloads.
    for (let y = 0; y < 256; y += 4) {
      ctx.fillStyle = y % 8 ? "rgba(102,45,8,.07)" : "rgba(255,227,158,.11)";
      ctx.fillRect(0, y, 256, 1);
    }
    for (let x = 0; x < 256; x += 6) { ctx.fillStyle = "rgba(86,35,3,.045)"; ctx.fillRect(x, 0, 1, 256); }
    ctx.strokeStyle = "rgba(120,49,0,.45)"; ctx.lineWidth = 4; ctx.strokeRect(8, 8, 240, 240);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(255,213,148,.65)"; ctx.lineWidth = 2; ctx.strokeRect(16, 16, 224, 224);
    this.texture.update();
    const fabric = this.material(scene, "vest-fabric", "#ffffff"); fabric.diffuseTexture = this.texture;
    const webbing = this.material(scene, "vest-webbing", "#26363a");
    const reflective = this.material(scene, "vest-reflective", "#dce6e5");
    const buckle = this.material(scene, "vest-buckle", "#101c21");
    const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
      mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false;
    };
    // Open neckline and armholes keep the silhouette closer to a real buoyancy aid.
    for (const x of [-0.16, 0.16]) {
      box("vest-front-panel", .29, .54, .09, x, .22, -.20, fabric);
      box("vest-shoulder", .13, .10, .42, x, .52, 0, fabric);
      box("vest-reflector", .21, .045, .012, x, .35, -.251, reflective);
    }
    box("vest-back", .58, .54, .09, 0, .22, .20, fabric);
    for (const y of [.07, .26]) {
      box("vest-strap-front", .59, .045, .015, 0, y, -.26, webbing);
      box("vest-strap-back", .59, .045, .015, 0, y, .26, webbing);
      for (const x of [-.30, .30]) box("vest-strap-side", .018, .045, .48, x, y, 0, webbing);
      box("vest-buckle", .09, .07, .025, 0, y, -.275, buckle);
    }
    this.root.setEnabled(false);
  }
  private material(scene: Scene, name: string, color: string): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color); material.specularColor.set(.05, .05, .05);
    this.materials.push(material); return material;
  }
  setEnabled(enabled: boolean): void { this.root.setEnabled(enabled); }
  dispose(): void { this.root.dispose(); this.materials.forEach(material => material.dispose()); this.texture.dispose(); }
}
