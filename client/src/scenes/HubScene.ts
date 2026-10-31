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
import {
  AssetLoader,
  type SpawnedAsset,
} from "../rendering/AssetLoader";
import { DialogueOverlay } from "../ui/DialogueOverlay";
import { NetworkClient } from "../network/NetworkClient";
import type {
  LocationChangedMessage,
  PlayerStateMessage,
  PlayersMessage,
  WelcomeMessage,
} from "../network/NetworkMessages";
import { RemotePlayer } from "../network/RemotePlayer";

export class HubScene {
  private readonly player: Player;
  private readonly cameraRig: CameraRig;
  private readonly input: InputController;
  private readonly interactions: InteractionSystem;
  private readonly dialogue: DialogueOverlay;
  private readonly interactionHint: HTMLDivElement;

  private readonly assetLoader: AssetLoader;
  private readonly environmentRoot: TransformNode;
  private readonly spawnedAssets: SpawnedAsset[] = [];
  private readonly remotePlayers = new Map<number, RemotePlayer>();
  private readonly networkUnsubscribers: Array<() => void> = [];
  private localUserId: number | null = null;
  private networkSendAccumulator = 0;

  private disposed = false;

  public constructor(
    private readonly scene: Scene,
    canvas: HTMLCanvasElement,
    private readonly network: NetworkClient,
  ) {
    this.environmentRoot = new TransformNode(
      "hub-environment-root",
      scene,
    );

    this.assetLoader = new AssetLoader(scene);

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

    this.networkUnsubscribers.push(
      this.network.on("welcome", this.handleWelcome),
      this.network.on("players", this.handlePlayers),
      this.network.on("location_changed", this.handleLocationChanged),
      this.network.on("error", (message) => {
        console.warn("[Sail Academy server]", message.message);
      }),
    );
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

    void this.loadHubAssets().catch((error) => {
      console.error("Не удалось загрузить ассеты хаба:", error);
    });
  }

  public update(deltaSeconds: number): void {
    const playerInput = this.input.getPlayerInput(this.cameraRig);
    const isPlayerMoving =
      playerInput.moveX !== 0 || playerInput.moveZ !== 0;

    this.player.setInput(playerInput);
    this.player.update(deltaSeconds);
    this.cameraRig.update(deltaSeconds, isPlayerMoving);
    this.interactions.update(this.player);

    this.updateNetwork(deltaSeconds);

    const now = performance.now();
    for (const remotePlayer of this.remotePlayers.values()) {
      remotePlayer.update(now);
    }
  }

  public dispose(): void {
    this.disposed = true;

    this.interactionHint.remove();
    this.dialogue.dispose();

    for (const unsubscribe of this.networkUnsubscribers) {
      unsubscribe();
    }
    this.networkUnsubscribers.length = 0;

    for (const remotePlayer of this.remotePlayers.values()) {
      remotePlayer.dispose();
    }
    this.remotePlayers.clear();

    for (const asset of this.spawnedAssets) {
      asset.dispose();
    }

    this.spawnedAssets.length = 0;

    this.environmentRoot.dispose();
    this.assetLoader.dispose();
    this.interactions.dispose();
    this.input.dispose();
    this.cameraRig.dispose();
    this.player.dispose();
  }


  private readonly handleWelcome = (message: WelcomeMessage): void => {
    this.localUserId = message.user_id;
    this.applyPlayerSnapshot(message.players);
  };

  private readonly handlePlayers = (message: PlayersMessage): void => {
    this.applyPlayerSnapshot(message.delta);
  };

  private readonly handleLocationChanged = (
    message: LocationChangedMessage,
  ): void => {
    for (const remotePlayer of this.remotePlayers.values()) {
      remotePlayer.dispose();
    }
    this.remotePlayers.clear();
    this.applyPlayerSnapshot(message.players);
  };

  private applyPlayerSnapshot(players: PlayerStateMessage[]): void {
    const presentIds = new Set<number>();

    for (const state of players) {
      if (state.id === this.localUserId) {
        continue;
      }

      presentIds.add(state.id);

      let remotePlayer = this.remotePlayers.get(state.id);
      if (!remotePlayer) {
        remotePlayer = new RemotePlayer(this.scene, state);
        this.remotePlayers.set(state.id, remotePlayer);
      } else {
        remotePlayer.pushSnapshot(state);
      }
    }

    // The current backend sends a complete room snapshot in `players.delta`,
    // so missing IDs mean that those players have left this room.
    for (const [userId, remotePlayer] of this.remotePlayers) {
      if (!presentIds.has(userId)) {
        remotePlayer.dispose();
        this.remotePlayers.delete(userId);
      }
    }
  }

  private updateNetwork(deltaSeconds: number): void {
    if (!this.network.isConnected) {
      return;
    }

    this.networkSendAccumulator += deltaSeconds;
    const sendInterval = 1 / 15;

    if (this.networkSendAccumulator < sendInterval) {
      return;
    }

    this.networkSendAccumulator %= sendInterval;

    const snapshot = this.player.getSnapshot();

    try {
      this.network.sendMovement({
        x: snapshot.x,
        // The local capsule origin is at y=1.1; server coordinates use the
        // ground-level origin (y=0), so convert between the two here.
        y: snapshot.y - 1.1,
        z: snapshot.z,
        ry: snapshot.yaw,
        anim: snapshot.animation,
      });
    } catch (error) {
      console.warn("[NetworkClient] Не удалось отправить движение:", error);
    }
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

  private async loadHubAssets(): Promise<void> {
    const urls = [
      "/assets/glb/environment/tree_palm_tall.glb",
      "/assets/glb/environment/tree_palm_bend.glb",
      "/assets/glb/environment/rock_large_a.glb",
      "/assets/glb/environment/rock_small_a.glb",
      "/assets/glb/environment/bush_large.glb",
      "/assets/glb/props/canoe.glb",
      "/assets/glb/props/sign.glb",
      "/assets/glb/props/crate.glb",
      "/assets/glb/props/flag.glb",
    ];

    await this.assetLoader.preload(urls);

    await Promise.all([
      this.spawnStaticAsset(
        "/assets/glb/environment/tree_palm_tall.glb",
        "palm-tall-01",
        new Vector3(-25, 0, -16),
        new Vector3(1.5, 1.5, 1.5),
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/tree_palm_tall.glb",
        "palm-tall-02",
        new Vector3(19, 0, -20),
        new Vector3(1.35, 1.35, 1.35),
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/tree_palm_bend.glb",
        "palm-bend-01",
        new Vector3(-21, 0, 8),
        new Vector3(1.2, 1.2, 1.2),
        Math.PI / 2,
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/rock_large_a.glb",
        "rock-large-01",
        new Vector3(-9, 0, -13),
        new Vector3(1.5, 1.5, 1.5),
        -0.4,
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/rock_small_a.glb",
        "rock-small-01",
        new Vector3(-7, 0, -11),
        new Vector3(0.9, 0.9, 0.9),
        0.7,
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/bush_large.glb",
        "bush-01",
        new Vector3(15, 0, 4),
        new Vector3(1.25, 1.25, 1.25),
      ),
      this.spawnStaticAsset(
        "/assets/glb/environment/bush_large.glb",
        "bush-02",
        new Vector3(18, 0, 7),
        new Vector3(0.9, 0.9, 0.9),
        1.4,
      ),
      this.spawnStaticAsset(
        "/assets/glb/props/canoe.glb",
        "canoe-01",
        new Vector3(-10, 0, -7),
        new Vector3(1.15, 1.15, 1.15),
        Math.PI / 2,
      ),
      this.spawnStaticAsset(
        "/assets/glb/props/sign.glb",
        "club-sign-01",
        new Vector3(-5, 0, 8),
        new Vector3(1.2, 1.2, 1.2),
      ),
      this.spawnStaticAsset(
        "/assets/glb/props/crate.glb",
        "crate-01",
        new Vector3(5, 0, 7),
        Vector3.One(),
        0.2,
      ),
      this.spawnStaticAsset(
        "/assets/glb/props/crate.glb",
        "crate-02",
        new Vector3(6.2, 0, 7.3),
        new Vector3(0.85, 0.85, 0.85),
        -0.5,
      ),
      this.spawnStaticAsset(
        "/assets/glb/props/flag.glb",
        "club-flag-01",
        new Vector3(-2, 0, 8),
        new Vector3(1.4, 1.4, 1.4),
      ),
    ]);
  }

  private async spawnStaticAsset(
    url: string,
    name: string,
    position: Vector3,
    scaling: Vector3,
    rotationY = 0,
  ): Promise<void> {
    const asset = await this.assetLoader.spawn(url, {
      name,
      parent: this.environmentRoot,
      position,
      rotation: new Vector3(0, rotationY, 0),
      scaling,
      checkCollisions: false,
    });

    if (this.disposed) {
      asset.dispose();
      return;
    }

    this.spawnedAssets.push(asset);

    for (const root of asset.roots) {
      root.freezeWorldMatrix();

      for (const mesh of root.getChildMeshes()) {
        mesh.freezeWorldMatrix();
      }
    }
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