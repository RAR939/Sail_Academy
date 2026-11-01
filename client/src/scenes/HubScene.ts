import { Scene, StandardMaterial, Color3, MeshBuilder, Mesh } from "@babylonjs/core";
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
import { ShoreEnvironment, SHORE_NPCS } from "../world/ShoreEnvironment";
import { Vector3 } from "@babylonjs/core";

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
  private readonly unsubscribers: Array<() => void> = [];
  private readonly vest: Mesh;
  private localUserId: number | null = null;
  private sendAccumulator = 0;
  private connected = false;
  private ready = false;
  private active = true;
  private busy = false;
  private disposed = false;
  private sessionVersion = 0;

  public constructor(private readonly scene: Scene, canvas: HTMLCanvasElement, private readonly network: NetworkClient) {
    this.environment = new ShoreEnvironment(scene);
    this.boatLesson = new BoatLesson(scene, this.environment.dinghy, () => {
      if (this.network.isConnected) this.network.createRace();
    });
    this.player = new Player(scene, { id: "local-player", spawn: new Vector3(0, 1.1, 0), runSpeed: 4 });
    this.cameraRig = new CameraRig(scene, canvas, {
      alpha: Math.PI / 2, beta: 0.85, radius: 12,
      minRadius: 4, maxRadius: 18, targetHeight: 0.35,
    });
    this.cameraRig.setTarget(this.player.collider);
    scene.activeCamera = this.cameraRig.camera;
    this.interactions = new InteractionSystem(scene);
    this.assetLoader = new AssetLoader(scene);
    this.chat = new NpcChat((id, text, signal) => this.api.dialog(id, text, signal), (reply) => this.applyStory(reply.story));
    this.hint.className = "interaction-hint";
    this.hint.hidden = true;
    document.body.append(this.hint);
    this.vest = MeshBuilder.CreateBox("player-lifejacket", { width: 0.62, height: 0.64, depth: 0.5 }, scene);
    this.vest.parent = this.player.collider;
    this.vest.position.y = 0.18;
    const vestMaterial = new StandardMaterial("player-vest-material", scene);
    vestMaterial.diffuseColor = Color3.FromHexString("#f39035");
    this.vest.material = vestMaterial;
    this.vest.setEnabled(false);
    this.input.setEnabled(false);
    this.cameraRig.setEnabled(false);

    for (const npc of SHORE_NPCS) {
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
      network.on("welcome", (message) => {
        this.localUserId = message.user_id;
        const own = message.players.find((state) => state.id === message.user_id);
        if (own) this.player.setPosition(new Vector3(own.x, own.y + 1.1, own.z));
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
  }

  public async enter(baseUrl: string, token: string): Promise<void> {
    const version = ++this.sessionVersion;
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
    this.environment.update(delta);
    if (this.ready) {
      const input = this.input.getPlayerInput(this.cameraRig);
      this.player.setInput(input);
      this.player.update(delta);
      this.cameraRig.update(delta, input.moveX !== 0 || input.moveZ !== 0);
      if (!this.chat.isOpen && !this.boatLesson.isOpen && !this.busy) this.interactions.update(this.player);
      const target = this.interactions.current;
      this.hint.textContent = target?.prompt ?? "";
      this.hint.hidden = !target || this.chat.isOpen || this.boatLesson.isOpen || this.busy;
      this.hud.update(this.player.collider.position.x, this.player.collider.position.z);
      this.sendAccumulator += delta;
      if (this.sendAccumulator >= 1 / 15) {
        this.sendAccumulator %= 1 / 15;
        this.sendMovement();
      }
    }
    for (const remote of this.remotePlayers.values()) remote.update(performance.now());
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
    this.vest.setEnabled(story.has_vest);
    this.environment.setTarget(story.position.x, story.position.z, !story.completed && this.ready);
  }

  private sendMovement(): void {
    if (!this.network.isConnected) return;
    const state = this.player.getSnapshot();
    this.network.sendMovement({ x: state.x, y: state.y - 1.1, z: state.z, ry: state.yaw, anim: state.animation });
  }

  private applySnapshot(players: PlayerStateMessage[]): void {
    const present = new Set<number>();
    for (const state of players) {
      if (state.id === this.localUserId) continue;
      present.add(state.id);
      const remote = this.remotePlayers.get(state.id);
      if (remote) remote.pushSnapshot(state);
      else this.remotePlayers.set(state.id, new RemotePlayer(this.scene, state));
    }
    for (const [id, remote] of this.remotePlayers) {
      if (!present.has(id)) { remote.dispose(); this.remotePlayers.delete(id); }
    }
  }

  private clearRemotePlayers(): void {
    this.remotePlayers.forEach((remote) => remote.dispose());
    this.remotePlayers.clear();
  }

  private async loadScenery(): Promise<void> {
    const placements: Array<[string, number, number, number]> = [
      ["environment/tree_palm_tall", -23, -7, 1.6],
      ["environment/tree_palm_tall", 27, -8, 1.8],
      ["environment/tree_palm_bend", -25, 17, 1.6],
      ["environment/tree_palm_tall", 30, 22, 1.7],
      ["environment/bush_large", -20, 23, 1.5],
      ["environment/bush_large", 25, 18, 1.3],
      ["environment/rock_large_a", -30, -9, 1.8],
      ["environment/rock_small_a", 32, -10, 1.7],
      ["props/crate", 18, 1, 1],
      ["props/crate", 19, 2, 0.8],
    ];
    await Promise.all(placements.map(async ([path, x, z, size], index) => {
      try {
        const asset = await this.assetLoader.spawn(`/assets/glb/${path}.glb`, {
          name: `shore-prop-${index}`, parent: this.environment.root,
          position: new Vector3(x, 0, z), scaling: new Vector3(size, size, size), checkCollisions: false,
        });
        if (this.disposed) { asset.dispose(); return; }
        this.assets.push(asset);
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
    this.assets.forEach((asset) => asset.dispose());
    this.assetLoader.dispose();
    this.interactions.dispose();
    this.input.dispose();
    this.cameraRig.dispose();
    this.vest.material?.dispose();
    this.player.dispose();
    this.environment.dispose();
  }
}
