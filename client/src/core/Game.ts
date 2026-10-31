import {
  Color4,
  Engine,
  Scene,
} from "@babylonjs/core";
import { HubScene } from "../scenes/HubScene";

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly hubScene: HubScene;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.74, 0.94, 1);
    this.scene.collisionsEnabled = true;

    this.hubScene = new HubScene(this.scene, canvas);
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;

      this.hubScene.update(deltaSeconds);
      this.scene.render();
    });

    window.addEventListener("resize", this.resize);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.hubScene.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly resize = (): void => {
    this.engine.resize();
  };
}