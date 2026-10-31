import {
  Color3,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CameraRig } from "../gameplay/CameraRig";
import { InteractionSystem } from "../gameplay/InteractionSystem";
import { Player } from "../gameplay/Player";
import { InputController } from "../input/InputController";
import { DialogueOverlay } from "../ui/DialogueOverlay";

export class HubScene {
  private readonly player: Player;
  private readonly cameraRig: CameraRig;
  private readonly input: InputController;
  private readonly interactions: InteractionSystem;
  private readonly dialogue: DialogueOverlay;
  private readonly interactionHint: HTMLDivElement;

  public constructor(
    private readonly scene: Scene,
    canvas: HTMLCanvasElement,
  ) {
    this.createEnvironment();

    this.player = new Player(scene, {
      id: "local-player",
      spawn: new Vector3(0, 1.1, 0),
    });

    this.cameraRig = new CameraRig(scene, canvas);
    this.cameraRig.setTarget(this.player.collider);
    scene.activeCamera = this.cameraRig.camera;

    this.input = new InputController();
    this.interactions = new InteractionSystem(scene);
    this.dialogue = new DialogueOverlay();
    this.interactionHint = this.createInteractionHint();

    this.interactions.onTargetChanged((target) => {
      if (this.dialogue.isOpen) {
        return;
      }

      this.interactionHint.textContent = target?.prompt ?? "";
      this.interactionHint.hidden = target === null;
    });

    this.createTestNpc();
  }

  public update(deltaSeconds: number): void {
    const playerInput = this.input.getPlayerInput(this.cameraRig);
    const isPlayerMoving =
      playerInput.moveX !== 0 || playerInput.moveZ !== 0;

    this.player.setInput(playerInput);
    this.player.update(deltaSeconds);
    this.cameraRig.update(deltaSeconds, isPlayerMoving);
    this.interactions.update(this.player);
  }

  public dispose(): void {
    this.interactionHint.remove();
    this.dialogue.dispose();

    this.interactions.dispose();
    this.input.dispose();
    this.cameraRig.dispose();
    this.player.dispose();
  }

  private createEnvironment(): void {
    const light = new HemisphericLight(
      "sun",
      new Vector3(0.3, 1, 0.2),
      this.scene,
    );

    light.intensity = 1.15;

    const sand = new StandardMaterial("sand-material", this.scene);
    sand.diffuseColor = new Color3(0.88, 0.76, 0.49);

    const ground = MeshBuilder.CreateGround(
      "beach-ground",
      { width: 80, height: 80 },
      this.scene,
    );

    ground.material = sand;
    ground.checkCollisions = true;

    const wallMaterial = new StandardMaterial("club-wall-material", this.scene);
    wallMaterial.diffuseColor = new Color3(0.93, 0.93, 0.88);

    const clubHouse = MeshBuilder.CreateBox(
      "club-house",
      { width: 12, height: 4, depth: 8 },
      this.scene,
    );

    clubHouse.position.set(0, 2, 12);
    clubHouse.material = wallMaterial;
    clubHouse.checkCollisions = true;

    const pier = MeshBuilder.CreateBox(
      "pier",
      { width: 4, height: 0.45, depth: 18 },
      this.scene,
    );

    pier.position.set(-14, 0.22, -10);
    pier.checkCollisions = true;

    this.createInclinedTestWalls();
  }

  private createInclinedTestWalls(): void {
    this.createInclinedWall(
      "wall-89-degrees",
      new Vector3(-12, 0, -4),
      89,
      new Color3(0.82, 0.28, 0.24),
    );

    this.createInclinedWall(
      "wall-60-degrees",
      new Vector3(0, 0, -8),
      60,
      new Color3(0.96, 0.63, 0.2),
    );

    this.createInclinedWall(
      "wall-30-degrees",
      new Vector3(12, 0, -4),
      30,
      new Color3(0.26, 0.58, 0.86),
    );
  }

  private createInclinedWall(
    name: string,
    position: Vector3,
    angleDegrees: number,
    color: Color3,
  ): void {
    const width = 7;
    const height = 0.35;
    const depth = 5;
    const angleRadians = (angleDegrees * Math.PI) / 180;

    const wall = MeshBuilder.CreateBox(
      name,
      { width, height, depth },
      this.scene,
    );

    // Центр располагается так, чтобы нижний край касался земли.
    const verticalHalfSize =
      (Math.abs(Math.sin(angleRadians)) * depth) / 2 +
      (Math.abs(Math.cos(angleRadians)) * height) / 2;

    wall.position.set(position.x, verticalHalfSize, position.z);
    wall.rotation.x = angleRadians;
    wall.checkCollisions = true;

    const material = new StandardMaterial(`${name}-material`, this.scene);
    material.diffuseColor = color;
    wall.material = material;
  }

  private createTestNpc(): void {
    const anchor = new TransformNode("captain-morozov-anchor", this.scene);
    anchor.position.set(4, 0, 2);

    const body = MeshBuilder.CreateCapsule(
      "captain-morozov",
      { height: 1.8, radius: 0.38, tessellation: 12 },
      this.scene,
    );

    body.parent = anchor;
    body.position.y = 0.9;

    const material = new StandardMaterial(
      "captain-morozov-material",
      this.scene,
    );

    material.diffuseColor = new Color3(0.94, 0.35, 0.2);
    body.material = material;

    this.interactions.register({
      id: "captain-morozov",
      kind: "npc",
      anchor,
      prompt: "Нажмите E, чтобы поговорить с Капитаном Морозовым",
      interactionRadius: 2.2,
      getHighlightMeshes: (): Mesh[] => [body],
      interact: () => this.openCaptainDialogue(),
    });
  }

  private openCaptainDialogue(): void {
    if (this.dialogue.isOpen) {
      return;
    }

    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);
    this.interactionHint.hidden = true;

    this.dialogue.open(
      [
        {
          speaker: "Капитан Морозов",
          text: "Добро пожаловать в Sail Academy. На воде побеждает не тот, кто сильнее, а тот, кто лучше читает ветер.",
          portraitLetter: "М",
          portraitColor: "#ba4b36",
        },
        {
          speaker: "Капитан Морозов",
          text: "Сначала разберёмся с берегом. Пирс впереди, а за ним начинается твоя первая настоящая тренировка.",
          portraitLetter: "М",
          portraitColor: "#ba4b36",
        },
        {
          speaker: "Капитан Морозов",
          text: "Когда будешь готов, возвращайся. Я расскажу, как лодка идёт против ветра.",
          portraitLetter: "М",
          portraitColor: "#ba4b36",
        },
      ],
      () => {
        this.input.setEnabled(true);
        this.cameraRig.setEnabled(true);

        const target = this.interactions.current;
        this.interactionHint.textContent = target?.prompt ?? "";
        this.interactionHint.hidden = target === null;
      },
    );
  }

  private createInteractionHint(): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "interaction-hint";
    element.hidden = true;
    document.body.append(element);
    return element;
  }
}