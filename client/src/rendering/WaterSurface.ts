import { DynamicTexture, Scene, StandardMaterial, Texture } from "@babylonjs/core";

/** Lightweight repeating, animated ripples generated locally. */
export class WaterSurface {
  private readonly texture: DynamicTexture;
  private elapsed = 0;
  constructor(scene: Scene, material: StandardMaterial, repeatU: number, repeatV: number) {
    this.texture = new DynamicTexture("water-ripples", { width: 256, height: 256 }, scene, true);
    const context = this.texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = "#9edcdd"; context.fillRect(0, 0, 256, 256);
    // Every curve is periodic in both axes, so the texture tiles without a seam.
    for (let row = 0; row < 16; row++) {
      for (const offset of [-256, 0, 256]) {
        context.beginPath();
        for (let x = 0; x <= 256; x += 4) {
          const y = row * 16 + offset + 3 * Math.sin(x * Math.PI * 2 / 128 + row * 1.31)
            + 1.4 * Math.sin(x * Math.PI * 2 / 64 - row * .77);
          if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = row % 2 ? "rgba(234,255,250,.30)" : "rgba(54,151,159,.18)";
        context.lineWidth = row % 2 ? 1.4 : 2;
        context.stroke();
      }
    }
    this.texture.update();
    this.texture.uScale = repeatU; this.texture.vScale = repeatV;
    this.texture.wrapU = Texture.WRAP_ADDRESSMODE; this.texture.wrapV = Texture.WRAP_ADDRESSMODE;
    material.diffuseTexture = this.texture;
  }
  update(delta: number): void {
    this.elapsed += Math.min(Math.max(delta, 0), .1);
    this.texture.uOffset = this.elapsed * .002;
    this.texture.vOffset = this.elapsed * .0015;
  }
  dispose(): void { this.texture.dispose(); }
}
