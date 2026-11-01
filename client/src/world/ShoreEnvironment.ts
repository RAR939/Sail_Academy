import {
  Color3, HemisphericLight, Mesh, MeshBuilder,
  Scene, StandardMaterial, Texture, TransformNode, Vector3,
} from "@babylonjs/core";
import { TrainingDinghy } from "./TrainingDinghy";
import { Nameplate } from "../rendering/Nameplate";
import { WaterSurface } from "../rendering/WaterSurface";
import { NpcFacing, type NearbyPlayer } from "./NpcFacing";
import type { WorldConfig, NpcConfig } from "./WorldConfig";

/** Coastal set with locally hosted surface textures. */
export class ShoreEnvironment {
  public readonly root: TransformNode;
  public readonly stations = new Map<string, { anchor: TransformNode; meshes: Mesh[] }>();
  private readonly materials: StandardMaterial[] = [];
  private readonly textures: Texture[] = [];
  private readonly labels: Nameplate[] = [];
  private readonly npcFacing: NpcFacing[] = [];
  private readonly marker: Mesh;
  private readonly flag: Mesh;
  private readonly water: WaterSurface;
  private time = 0;
  public readonly dinghy: TrainingDinghy;

  public constructor(private readonly scene: Scene, world: WorldConfig, private readonly editing = false) {
    this.root = new TransformNode("shore-environment", scene);
    const settings = world.environment;
    const sky = Color3.FromHexString(settings.sky);
    scene.clearColor.set(sky.r, sky.g, sky.b, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky;
    scene.fogStart = settings.fogStart;
    scene.fogEnd = settings.fogEnd;
    const light = new HemisphericLight("shore-sun", new Vector3(-0.4, 1, -0.3), scene);
    light.intensity = settings.lightIntensity;
    light.groundColor = new Color3(0.4, 0.47, 0.42);
    light.parent = this.root;
    const materials = new Map(Object.entries(settings.materials).map(([name, color]) => [name, this.material(name, color)]));
    const material = (name: string): StandardMaterial => {
      const value = materials.get(name);
      if (!value) throw new Error(`Неизвестный материал мира: ${name}`);
      return value;
    };
    const surfaceTextures: Array<[string, string, number, number]> = [
      ["warm-sand", "sand_03.jpg", 12, 8],
      ["pier-wood", "wooden_planks.jpg", 2, 3],
      ["ivory-walls", "painted_plaster_wall.jpg", 3, 2],
    ];
    for (const [name, file, uScale, vScale] of surfaceTextures) {
      const texture = new Texture(`/assets/textures/coast/${file}`, scene);
      texture.uScale = uScale; texture.vScale = vScale;
      texture.wrapU = Texture.WRAP_ADDRESSMODE; texture.wrapV = Texture.WRAP_ADDRESSMODE;
      material(name).diffuseTexture = texture;
      this.textures.push(texture);
    }
    material("warm-sand").emissiveColor = Color3.FromHexString("#302419");
    this.water = new WaterSurface(scene, material("sea"), 30, 25);
    const sea = MeshBuilder.CreateGround("sea", { width: settings.sea.width, height: settings.sea.height }, scene);
    sea.position.set(...settings.sea.position);
    sea.material = material("sea");
    sea.parent = this.root;
    const vestMeshes: Mesh[] = [];
    let flag: Mesh | null = null;
    const boatConfig = world.boxes.find((item) => item.name === "training-dinghy");
    for (const [index, item] of world.boxes.entries()) {
      if (item.name === "training-dinghy" || item.name === "dinghy-boom") continue;
      const mesh = this.box(item.name, item.size, item.position, material(item.material), item.collision);
      if (editing) mesh.metadata = { editorSelection: `box:${index}` };
      mesh.isVisible = item.visible;
      if (item.name.startsWith("orange-vest-")) vestMeshes.push(mesh);
      if (item.name === "wind-flag") flag = mesh;
    }
    if (!flag || !boatConfig) throw new Error("В мире отсутствуют флаг или учебная лодка");
    this.flag = flag;
    for (const [index, item] of world.cylinders.entries()) {
      if (item.name !== "dinghy-mast") { const mesh = this.cylinder(item.name, item.height, item.diameter, item.position, material(item.material)); if (editing) mesh.metadata = { editorSelection: `cylinder:${index}` }; }
    }
    for (const item of world.labels) this.label(item.text, Vector3.FromArray(item.position), item.width, item.height, item.billboard);
    this.dinghy = new TrainingDinghy(scene, this.root);
    this.dinghy.root.position.set(...boatConfig.position);
    for (const id of ["vest", "pier"] as const) {
      const anchor = new TransformNode(`${id}-station`, scene);
      anchor.parent = this.root;
      anchor.position.set(...world.stations[id]);
      this.stations.set(id, { anchor, meshes: id === "vest" ? vestMeshes : [...this.dinghy.parts.values()].flat() });
    }
    this.dinghy.onModelLoaded = () => {
      const meshes = this.stations.get("pier")?.meshes;
      if (meshes) meshes.splice(0, meshes.length, ...[...this.dinghy.parts.values()].flat());
    };
    for (const npc of world.npcs) this.createNpc(npc);
    this.decorateBeach();
    const gold = this.material("quest-gold", "#ffd076");
    gold.emissiveColor = Color3.FromHexString("#be8a25");
    this.marker = MeshBuilder.CreatePolyhedron("quest-beacon", { type: 1, size: 0.35 }, scene);
    this.marker.material = gold;
    this.marker.parent = this.root;
    this.marker.setEnabled(false);
    if (!editing) this.mergeStaticGeometry();
  }

  public setTarget(x: number, z: number, visible: boolean): void {
    this.marker.position.set(x, 3.5, z);
    this.marker.setEnabled(visible);
  }

  public update(delta: number, players: readonly NearbyPlayer[] = []): void {
    for (const facing of this.npcFacing) facing.update(players, delta);
    this.time += Math.min(delta, 0.1);
    this.marker.rotation.y = this.time;
    this.marker.position.y = 3.5 + Math.sin(this.time * 2) * 0.18;
    this.dinghy.update(delta);
    this.water.update(delta);
    this.flag.rotation.y = Math.sin(this.time * 3) * 0.1;
  }

  public dispose(): void {
    this.dinghy.dispose();
    this.water.dispose();
    this.root.dispose();
    this.labels.forEach((label) => label.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
  }

  private decorateBeach(): void {
    const canvas = this.material("beach-parasol-canvas", "#f1dfbf");
    const trim = this.material("beach-parasol-trim", "#6a9da3");
    const wood = this.material("beach-furniture-wood", "#98704f");
    for (const [index, x, z] of [[0, -33, 2], [1, 33, 7]] as const) {
      const root = new TransformNode(`beach-rest-${index}`, this.scene);
      root.parent = this.root; root.position.set(x, 0, z);
      const pole = MeshBuilder.CreateCylinder(`parasol-pole-${index}`, { height: 2.5, diameter: .07, tessellation: 8 }, this.scene);
      pole.parent = root; pole.position.y = 1.25; pole.material = wood;
      const shade = MeshBuilder.CreateCylinder(`parasol-top-${index}`, { height: .5, diameterTop: .08, diameterBottom: 3, tessellation: 12 }, this.scene);
      shade.parent = root; shade.position.y = 2.45; shade.material = index ? trim : canvas;
      const cap = MeshBuilder.CreateCylinder(`parasol-rim-${index}`, { height: .09, diameter: 3, tessellation: 12 }, this.scene);
      cap.parent = root; cap.position.y = 2.21; cap.material = index ? canvas : trim;
      for (const dx of [-.55, .55]) {
        const leg = MeshBuilder.CreateBox(`bench-leg-${index}`, { width: .1, height: .44, depth: .45 }, this.scene);
        leg.parent = root; leg.position.set(dx, .22, 1.15); leg.material = wood;
      }
      const seat = MeshBuilder.CreateBox(`bench-seat-${index}`, { width: 1.5, height: .1, depth: .5 }, this.scene);
      seat.parent = root; seat.position.set(0, .48, 1.15); seat.material = wood;
    }
  }

  private createNpc(npc: NpcConfig): void {
    const anchor = new TransformNode(`npc-${npc.id}`, this.scene);
    anchor.parent = this.root;
    anchor.position.set(npc.x, 0, npc.z);
    this.npcFacing.push(new NpcFacing(anchor));
    const shirt = this.material(`${npc.id}-shirt`, npc.color);
    const pants = this.material(`${npc.id}-pants`, "#294453");
    const skin = this.material(`${npc.id}-skin`, "#d7ad85");
    const meshes: Mesh[] = [];
    const body = MeshBuilder.CreateCapsule(`${npc.id}-body`, { height: 0.85, radius: 0.27, tessellation: 8 }, this.scene);
    body.material = shirt;
    body.position.y = 1.1;
    body.parent = anchor;
    meshes.push(body);
    const head = MeshBuilder.CreateSphere(`${npc.id}-head`, { diameter: 0.43, segments: 8 }, this.scene);
    head.position.y = 1.75;
    head.material = skin;
    head.parent = anchor;
    meshes.push(head);
    for (const x of [-0.14, 0.14]) {
      const leg = this.box(`${npc.id}-leg`, [0.18, 0.72, 0.22], [x, 0.36, 0], pants);
      leg.parent = anchor;
      meshes.push(leg);
    }
    for (const x of [-0.35, 0.35]) {
      const arm = this.box(`${npc.id}-arm`, [0.14, 0.7, 0.17], [x, 1.08, 0], shirt);
      arm.parent = anchor;
      meshes.push(arm);
    }
    this.stations.set(npc.id, { anchor, meshes });
  }

  private material(name: string, hex: string): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor.set(0.08, 0.08, 0.08);
    this.materials.push(material);
    return material;
  }

  private mergeStaticGeometry(): void {
    const interactive = new Set([...this.stations.values()].flatMap((station) => station.meshes));
    const groups = new Map<string, Mesh[]>();
    for (const node of this.root.getChildren()) {
      if (!(node instanceof Mesh) || node === this.flag || node === this.marker || interactive.has(node) || node.name.startsWith("label-plane")) continue;
      const key = `${node.material?.uniqueId}-${node.checkCollisions}-${node.isVisible}`;
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      const collision = first.checkCollisions;
      const visible = first.isVisible;
      const merged = group.length > 1 ? Mesh.MergeMeshes(group, true, true) : first;
      if (!merged) continue;
      merged.parent = this.root;
      merged.checkCollisions = collision;
      merged.isVisible = visible;
      merged.freezeWorldMatrix();
    }
  }

  private box(name: string, size: number[], position: number[], material: StandardMaterial, collision = false): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: size[0]!, height: size[1]!, depth: size[2]! }, this.scene);
    mesh.position.set(position[0]!, position[1]!, position[2]!);
    mesh.material = material;
    mesh.checkCollisions = collision;
    mesh.parent = this.root;
    return mesh;
  }

  private cylinder(name: string, height: number, diameter: number, position: number[], material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 10 }, this.scene);
    mesh.position.set(position[0]!, position[1]!, position[2]!);
    mesh.material = material;
    mesh.parent = this.root;
    return mesh;
  }

  private label(text: string, position: Vector3, width: number, height: number, billboard = true): void {
    this.labels.push(new Nameplate(this.scene, text, position, width, height, this.root, billboard));
  }
}
