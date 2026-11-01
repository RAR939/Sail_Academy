import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

/** A readable translucent sign shared by characters and the shore. */
export class Nameplate {
  public readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;

  constructor(scene: Scene, text: string, position: Vector3, width: number, height: number, parent: TransformNode, billboard = true, subtitle?: string) {
    this.texture = new DynamicTexture(`label-texture-${text}`, { width: 1024, height: 256 }, scene, true);
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.beginPath();
    ctx.roundRect(12, 12, 1000, 232, 48);
    ctx.fillStyle = "rgba(13, 38, 48, 0.42)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(197, 225, 218, 0.20)";
    ctx.stroke();
    ctx.fillStyle = "#e7b978";
    ctx.beginPath(); ctx.roundRect(40, 57, 7, 142, 4); ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = subtitle ? [text, subtitle] : text.split("\n");
    if (lines.length === 1) {
      ctx.font = "600 78px system-ui, sans-serif";
      ctx.fillStyle = "#f8f4e9";
      ctx.fillText(lines[0]!, 520, 130, 890);
    } else {
      ctx.font = "600 69px system-ui, sans-serif";
      ctx.fillStyle = "#f8f4e9";
      ctx.fillText(lines[0]!, 520, 95, 890);
      ctx.font = "500 43px system-ui, sans-serif";
      ctx.fillStyle = "#c4ddd9";
      ctx.fillText(lines[1]!, 520, 168, 890);
    }
    this.texture.hasAlpha = true;
    this.texture.update();
    this.material = new StandardMaterial(`label-material-${text}`, scene);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.emissiveColor = Color3.White();
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.specularColor = Color3.Black();
    this.mesh = MeshBuilder.CreatePlane(`label-plane-${text}`, { width: width * 0.72, height: height * 0.72 }, scene);
    this.mesh.position.copyFrom(position);
    this.mesh.parent = parent;
    this.mesh.isPickable = false;
    this.mesh.material = this.material;
    if (billboard) this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  }

  dispose(): void { this.mesh.dispose(); this.material.dispose(); this.texture.dispose(); }
}
