import { Scene, Material } from "@babylonjs/core";
import { CameraRig } from "../gameplay/CameraRig";
import { InteractionSystem } from "../gameplay/InteractionSystem";
import { Player } from "../gameplay/Player";
import { InputController } from "../input/InputController";
import { AssetLoader, type SpawnedAsset } from "../rendering/AssetLoader";
import { NetworkClient } from "../network/NetworkClient";
import type { PlayerStateMessage } from "../network/NetworkMessages";
import { RemotePlayer } from "../network/RemotePlayer";
import { ShoreApi, type ShoreStory } from "../network/ShoreApi";
import { NpcChat } from "../ui/NpcChat";
import { BoatLesson } from "../ui/BoatLesson";
import { ShoreHud } from "../ui/ShoreHud";
import { ShoreEnvironment } from "../world/ShoreEnvironment";
import type { WorldConfig } from "../world/WorldConfig";
import { Character } from "../rendering/Character";
import { LifeJacket } from "../rendering/LifeJacket";
import { AmbientCrowd } from "../world/AmbientCrowd";
import { createPropCollider } from "../rendering/PropCollisions";
import { TransformNode, Vector3 } from "@babylonjs/core";

export class HubScene {
  private readonly player: Player;
  private readonly cameraRig: CameraRig;
  private readonly input = new InputController();
  private readonly interactions: InteractionSystem;
  private readonly api = new ShoreApi();
  private readonly chat: NpcChat;
  private readonly boatLesson: BoatLesson;
  private readonly hud = new ShoreHud();
  private readonly environment: ShoreEnvironment;
  private readonly assetLoader: AssetLoader;
  private readonly assets: SpawnedAsset[] = [];
  private readonly hint = document.createElement("div");
  private readonly remotePlayers = new Map<number, RemotePlayer>();
  private lastPlayers: PlayerStateMessage[] = [];
  private readonly npcCharacters: Character[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private readonly vest: LifeJacket;
  private hasVest = false;
  private readonly crowd: AmbientCrowd;
  private localCharacter: Character | null = null;
  private localUsername = "";
  private localUserId: number | null = null;
  private sendAccumulator = 0;
  private connected = false;
  private ready = false;
  private active = true;
  private busy = false;
  private disposed = false;
  private sessionVersion = 0;

  public constructor(private readonly scene: Scene, canvas: HTMLCanvasElement, private readonly network: NetworkClient, private readonly world: WorldConfig) {
    this.environment = new ShoreEnvironment(scene, world);
    this.boatLesson = new BoatLesson(scene, this.environment.dinghy, () => {
      if (this.network.isConnected) this.network.createRace();
    }, (roomId) => {
      if (this.network.isConnected) this.network.enterLocation("race_track", roomId);
    });
    this.player = new Player(scene, { id: "local-player", spawn: new Vector3(0, 1.1, 0), ...world.player });
    this.cameraRig = new CameraRig(scene, canvas, {
      alpha: -Math.PI / 2, beta: world.camera.beta, radius: world.camera.distance,
      minRadius: world.camera.minDistance, maxRadius: world.camera.maxDistance,
      targetHeight: world.camera.height, followSpeed: world.camera.followSpeed, manualDelay: world.camera.manualDelay,
    });
    this.cameraRig.setTarget(this.player.collider);
    scene.activeCamera = this.cameraRig.camera;
    this.interactions = new InteractionSystem(scene);
    this.assetLoader = new AssetLoader(scene);
    this.chat = new NpcChat((id, text, signal) => this.api.dialog(id, text, signal), (reply) => this.applyStory(reply.story));
    this.hint.className = "interaction-hint";
    this.hint.hidden = true;
    document.body.append(this.hint);
    this.vest = new LifeJacket(scene, this.player.collider);
    this.crowd = new AmbientCrowd(scene, this.assetLoader, this.environment.root);
    const visitorLines = [
      "Привет! Сегодня отличный день для тренировки.",
      "Перед выходом на воду не забудь застегнуть жилет.",
      "На дистанции следи за ветром и другими лодками.",
      "Удачи на воде!",
    ];
    this.crowd.visitors.forEach((visitor, index) => {
      this.interactions.register({
        id: `visitor-${index}`, kind: "npc", anchor: visitor.anchor,
        prompt: "E — поздороваться", interactionRadius: 2.4,
        getHighlightMeshes: () => visitor.character.getMeshes(),
        interact: () => { if (this.ready) this.hud.toast(visitorLines[index % visitorLines.length]!); },
      });
    });
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);

    for (const npc of world.npcs) {
      const station = this.environment.stations.get(npc.id)!;
      this.interactions.register({
        id: npc.id, kind: "npc", anchor: station.anchor,
        prompt: `E — поговорить: ${npc.name}`, interactionRadius: 2.8,
        getHighlightMeshes: () => station.meshes,
        interact: () => {
          if (!this.ready || this.chat.isOpen || this.busy) return;
          // Ensure the authoritative position is current before the HTTP request.
          this.sendMovement();
          this.input.setEnabled(false);
          this.cameraRig.setEnabled(false);
          this.hint.hidden = true;
          this.chat.open(npc, () => {
            this.input.setEnabled(this.ready);
            this.cameraRig.setEnabled(this.ready);
            if (this.ready) canvas.focus();
          });
        },
      });
    }
    for (const id of ["vest", "pier"]) {
      const station = this.environment.stations.get(id)!;
      this.interactions.register({
        id, kind: "item", anchor: station.anchor,
        prompt: id === "vest" ? "E — взять и застегнуть жилет" : "E — осмотреть учебную лодку",
        interactionRadius: 2.8,
        getHighlightMeshes: () => station.meshes,
        interact: async () => {
          if (!this.ready || this.busy || this.chat.isOpen) return;
          this.busy = true;
          const version = this.sessionVersion;
          this.sendMovement();
          try {
            const result = await this.api.interact(id);
            if (this.disposed || !this.ready || version !== this.sessionVersion) return;
            this.applyStory(result.story);
            this.hud.toast(result.text);
            if (id === "pier") {
              this.input.setEnabled(false); this.cameraRig.setEnabled(false);
              this.boatLesson.open(() => { this.input.setEnabled(this.ready); this.cameraRig.setEnabled(this.ready); if (this.ready) canvas.focus(); });
            }
          } catch (error) {
            if (!this.disposed) this.hud.toast(error instanceof Error ? error.message : "Не удалось выполнить действие.");
          } finally { this.busy = false; }
        },
      });
    }
    this.unsubscribers.push(
      network.on("error", (message) => { if (this.active && this.ready) this.hud.toast(message.message); }),
      network.on("welcome", (message) => {
        this.localUserId = message.user_id;
        this.localUsername = message.username;
        const own = message.players.find((state) => state.id === message.user_id);
        if (own) {
          this.player.setPosition(new Vector3(own.x, own.y + 1.1, own.z));
          this.cameraRig.snapToTarget();
        }
        this.applySnapshot(message.players);
      }),
      network.on("players", (message) => this.applySnapshot(message.delta)),
      network.on("location_changed", (message) => this.applySnapshot(message.players)),
      network.onStatus((status) => {
        this.connected = status === "connected";
        if (!this.connected) {
          this.sessionVersion++;
          this.ready = false;
          this.chat.close();
          this.boatLesson.close();
          this.input.setEnabled(false);
          this.cameraRig.setEnabled(false);
          this.hud.setVisible(false);
          this.hint.hidden = true;
          this.environment.setTarget(0, 0, false);
          this.clearRemotePlayers();
        }
      }),
    );
    void this.loadScenery();
    void this.loadNpcCharacters();
  }

  public get canApplyWorld(): boolean { return !this.chat.isOpen && !this.boatLesson.isOpen && !this.busy; }

  public captureSession(): { userId: number | null; username: string; position: Vector3; yaw: number; cameraAlpha: number; cameraBeta: number; players: PlayerStateMessage[] } {
    return { userId: this.localUserId, username: this.localUsername, position: this.player.collider.position.clone(), yaw: this.player.collider.rotation.y, cameraAlpha: this.cameraRig.camera.alpha, cameraBeta: this.cameraRig.camera.beta, players: this.lastPlayers };
  }

  public restoreSession(state: ReturnType<HubScene["captureSession"]>): void {
    this.localUserId = state.userId;
    this.localUsername = state.username;
    this.player.setPosition(state.position);
    this.player.collider.rotation.y = state.yaw;
    this.cameraRig.camera.alpha = state.cameraAlpha;
    this.cameraRig.camera.beta = state.cameraBeta;
    this.cameraRig.snapToTarget();
    this.applySnapshot(state.players);
  }

  public async enter(baseUrl: string, token: string, skin: string): Promise<void> {
    const version = ++this.sessionVersion;
    this.localCharacter?.dispose();
    this.localCharacter = new Character(this.scene, this.assetLoader, this.player.collider, this.localUsername);
    await this.localCharacter.load(skin);
    if (this.disposed || !this.connected || version !== this.sessionVersion) return;
    this.player.visual.setEnabled(false);
    this.api.configure(baseUrl, token);
    const story = await this.api.story();
    if (this.disposed || !this.connected || version !== this.sessionVersion) return;
    this.ready = true;
    this.applyStory(story);
    this.input.setEnabled(true);
    this.cameraRig.setEnabled(true);
    this.hud.toast("Добро пожаловать в клуб. Следуйте золотому маяку и нажимайте E рядом с целью.");
  }

  public update(delta: number): void {
    if (!this.active) return;
    if (this.ready) {
      const input = this.input.getPlayerInput(this.cameraRig);
      this.player.setInput(input);
      this.player.update(delta);
      this.localCharacter?.animate(this.player.getSnapshot().animation);
      this.cameraRig.update(delta, input.run && this.player.speed > this.world.player.walkSpeed * 0.95, this.player.movementDirection);
      if (!this.chat.isOpen && !this.boatLesson.isOpen && !this.busy) this.interactions.update(this.player);
      const target = this.interactions.current;
      this.hint.textContent = target?.id === "vest"
        ? (this.hasVest ? "E — снять жилет" : "E — надеть жилет")
        : target?.prompt ?? "";
      this.hint.hidden = !target || this.chat.isOpen || this.boatLesson.isOpen || this.busy;
      this.hud.update(this.player.collider.position.x, this.player.collider.position.z);
      this.sendAccumulator += delta;
      if (this.sendAccumulator >= 1 / 15) {
        this.sendAccumulator %= 1 / 15;
        this.sendMovement();
      }
    }
    for (const remote of this.remotePlayers.values()) remote.update(performance.now());
    const nearbyPlayers = this.ready
      ? [
          { id: this.localUserId ?? -1, position: this.player.collider.position },
          ...Array.from(this.remotePlayers, ([id, remote]) => ({ id, position: remote.position })),
        ]
      : [];
    this.environment.update(delta, nearbyPlayers);
    this.crowd.update(delta, nearbyPlayers);
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.input.setEnabled(active && this.ready);
    this.cameraRig.setEnabled(active && this.ready);
    this.hud.setVisible(active && this.ready);
    if (!active) this.hint.hidden = true;
  }

  private applyStory(story: ShoreStory): void {
    this.hud.setStory(story);
    this.hud.setVisible(this.ready);
    this.hasVest = story.has_vest;
    this.vest.setEnabled(this.hasVest);
    this.environment.setTarget(story.position.x, story.position.z, !story.completed && this.ready);
  }

  private sendMovement(): void {
    if (!this.network.isConnected) return;
    const state = this.player.getSnapshot();
    this.network.sendMovement({ x: state.x, y: state.y - 1.1, z: state.z, ry: state.yaw, anim: state.animation });
  }

  private applySnapshot(players: PlayerStateMessage[]): void {
    this.lastPlayers = players.map((state) => ({ ...state }));
    const present = new Set<number>();
    for (const state of players) {
      if (state.id === this.localUserId) { this.player.speedMultiplier = state.speed_multiplier ?? 1; continue; }
      present.add(state.id);
      const remote = this.remotePlayers.get(state.id);
      if (remote) remote.pushSnapshot(state);
      else this.remotePlayers.set(state.id, new RemotePlayer(this.scene, state, this.assetLoader));
    }
    for (const [id, remote] of this.remotePlayers) {
      if (!present.has(id)) { remote.dispose(); this.remotePlayers.delete(id); }
    }
  }

  private clearRemotePlayers(): void {
    this.remotePlayers.forEach((remote) => remote.dispose());
    this.remotePlayers.clear();
  }

  private async loadNpcCharacters(): Promise<void> {
    await Promise.all(this.world.npcs.map(async (npc) => {
      const station = this.environment.stations.get(npc.id)!;
      const anchor = new TransformNode(`npc-visual-${npc.id}`, this.scene);
      anchor.parent = station.anchor;
      anchor.position.y = 0.9;
      const character = new Character(this.scene, this.assetLoader, anchor, npc.name, npc.role);
      this.npcCharacters.push(character);
      try {
        await character.load(npc.skin);
        if (this.disposed) return;
        const meshes = character.getMeshes();
        if (!meshes.length) throw new Error("Модель NPC не содержит мешей");
        station.meshes.forEach((mesh) => mesh.dispose());
        station.meshes = meshes;
      } catch (error) {
        console.warn("Не удалось загрузить модель NPC", npc.id, error);
        character.dispose();
        anchor.dispose();
      }
    }));
  }

  private async loadScenery(): Promise<void> {
    const placements = this.world.props;
    await Promise.all(placements.map(async ([path, x, z, size], index) => {
      try {
        const asset = await this.assetLoader.spawn(`/assets/glb/${path}.glb`, {
          name: `shore-prop-${index}`, parent: this.environment.root,
          position: new Vector3(x, 0, z), scaling: new Vector3(size, size, size), checkCollisions: false,
        });
        if (this.disposed) { asset.dispose(); return; }
        this.assets.push(asset);
        // Kenney foliage and props contain open faces; keep the opaque faces
        // visible from both sides rather than showing holes from behind.
        for (const root of asset.roots) for (const mesh of root.getChildMeshes()) {
          if (mesh.material) {
            mesh.material.backFaceCulling = false;
            mesh.material.transparencyMode = Material.MATERIAL_OPAQUE;
            mesh.material.alpha = 1;
          }
        }
        const collider = createPropCollider(this.scene, asset, this.environment.root, path, x, z, size);
        if (!collider) console.warn("Не удалось построить коллизию декорации", path);
        for (const root of asset.roots) { root.freezeWorldMatrix(); root.getChildMeshes().forEach((mesh) => mesh.freezeWorldMatrix()); }
      } catch (error) { console.warn("Не удалось загрузить декорацию", path, error); }
    }));
  }

  public dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.chat.dispose();
    this.boatLesson.dispose();
    this.hud.dispose();
    this.hint.remove();
    this.clearRemotePlayers();
    this.localCharacter?.dispose();
    this.npcCharacters.forEach((character) => character.dispose());
    this.assets.forEach((asset) => asset.dispose());
    this.assetLoader.dispose();
    this.interactions.dispose();
    this.input.dispose();
    this.cameraRig.dispose();
    this.vest.dispose();
    this.crowd.dispose();
    this.player.dispose();
    this.environment.dispose();
  }
}
