import {
  Color3, HemisphericLight, Mesh, MeshBuilder,
  Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import { Nameplate } from "../rendering/Nameplate";
import { NpcFacing, type NearbyPlayer } from "./NpcFacing";
import type { WorldConfig, NpcConfig } from "./WorldConfig";

/** Code-built coastal set: no external textures or network dependencies. */
export class ShoreEnvironment {
  public readonly root: TransformNode;
  public readonly stations = new Map<string, { anchor: TransformNode; meshes: Mesh[] }>();
  private readonly materials: StandardMaterial[] = [];
  private readonly labels: Nameplate[] = [];
  private readonly npcFacing: NpcFacing[] = [];
  private readonly marker: Mesh;
  private readonly flag: Mesh;
  private time = 0;

  public constructor(private readonly scene: Scene, world: WorldConfig) {
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
    const sea = MeshBuilder.CreateGround("sea", { width: settings.sea.width, height: settings.sea.height }, scene);
    sea.position.set(...settings.sea.position);
    sea.material = material("sea");
    sea.parent = this.root;
    const vestMeshes: Mesh[] = [];
    let flag: Mesh | null = null;
    let hull: Mesh | null = null;
    for (const item of world.boxes) {
      const mesh = this.box(item.name, item.size, item.position, material(item.material), item.collision);
      mesh.isVisible = item.visible;
      if (item.name.startsWith("orange-vest-")) vestMeshes.push(mesh);
      if (item.name === "wind-flag") flag = mesh;
      if (item.name === "training-dinghy") hull = mesh;
    }
    if (!flag || !hull) throw new Error("В мире отсутствуют флаг или учебная лодка");
    this.flag = flag;
    for (const item of world.cylinders) this.cylinder(item.name, item.height, item.diameter, item.position, material(item.material));
    for (const item of world.labels) this.label(item.text, Vector3.FromArray(item.position), item.width, item.height, item.billboard);
    const bow = MeshBuilder.CreateCylinder("dinghy-bow", { height: world.special.bow.height, diameter: world.special.bow.diameter, tessellation: 3 }, scene);
    bow.position.set(...world.special.bow.position); bow.material = material("ivory-walls"); bow.parent = this.root;
    const sail = MeshBuilder.CreateCylinder("training-sail", { height: 0.025, diameter: world.special.sail.diameter, tessellation: 3 }, scene);
    sail.rotation.z = Math.PI / 2; sail.rotation.y = Math.PI / 2;
    sail.scaling.set(...world.special.sail.scale); sail.position.set(...world.special.sail.position);
    sail.material = material("ivory-walls"); sail.parent = this.root;
    for (const id of ["vest", "pier"] as const) {
      const anchor = new TransformNode(`${id}-station`, scene);
      anchor.parent = this.root;
      anchor.position.set(...world.stations[id]);
      this.stations.set(id, { anchor, meshes: id === "vest" ? vestMeshes : [hull, sail] });
    }
    for (const npc of world.npcs) this.createNpc(npc);
    const gold = this.material("quest-gold", "#ffd076");
    gold.emissiveColor = Color3.FromHexString("#be8a25");
    this.marker = MeshBuilder.CreatePolyhedron("quest-beacon", { type: 1, size: 0.35 }, scene);
    this.marker.material = gold;
    this.marker.parent = this.root;
    this.marker.setEnabled(false);
    this.mergeStaticGeometry();
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
    this.flag.rotation.y = Math.sin(this.time * 3) * 0.1;
  }

  public dispose(): void {
    this.root.dispose();
    this.labels.forEach((label) => label.dispose());
    this.materials.forEach((material) => material.dispose());
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
