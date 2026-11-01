import {
  Color3, DynamicTexture, HemisphericLight, Mesh, MeshBuilder,
  Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import type { NpcIdentity } from "../ui/NpcChat";

export const SHORE_NPCS: Array<NpcIdentity & { x: number; z: number }> = [
  { id: "captain", name: "Капитан Морозов", role: "Главный тренер · основы парусного спорта", color: "#e8b96b", x: 4, z: 3 },
  { id: "weather", name: "Метеоролог Ли", role: "Погода и безопасность", color: "#67cfc5", x: -10, z: 4 },
  { id: "judge", name: "Судья Анна", role: "Правила и право пути", color: "#a6b9f5", x: 10, z: 11 },
  { id: "sailor", name: "Михалыч", role: "Морские слова и жизнь у причала", color: "#e69b7a", x: -10, z: -12 },
];

/** Code-built coastal set: no external textures or network dependencies. */
export class ShoreEnvironment {
  public readonly root: TransformNode;
  public readonly stations = new Map<string, { anchor: TransformNode; meshes: Mesh[] }>();
  private readonly materials: StandardMaterial[] = [];
  private readonly textures: DynamicTexture[] = [];
  private readonly marker: Mesh;
  private readonly flag: Mesh;
  private time = 0;

  public constructor(private readonly scene: Scene) {
    this.root = new TransformNode("shore-environment", scene);
    scene.clearColor.set(0.66, 0.84, 0.91, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.66, 0.84, 0.91);
    scene.fogStart = 100;
    scene.fogEnd = 250;
    const light = new HemisphericLight("shore-sun", new Vector3(-0.4, 1, -0.3), scene);
    light.intensity = 1.15;
    light.groundColor = new Color3(0.4, 0.47, 0.42);
    light.parent = this.root;

    const sand = this.material("warm-sand", "#d8c293");
    const grass = this.material("dune-grass", "#83916c");
    const wood = this.material("pier-wood", "#96714e");
    const white = this.material("ivory-walls", "#efe7d6");
    const navy = this.material("club-navy", "#254a5d");
    const roof = this.material("roof", "#b7624c");
    const metal = this.material("metal", "#b5c6c9");
    const orange = this.material("lifejacket", "#f39035");
    const water = this.material("sea", "#3e9ea8");
    water.specularColor.set(0.5, 0.7, 0.7);
    const sea = MeshBuilder.CreateGround("sea", { width: 420, height: 350 }, scene);
    sea.position.set(0, -0.35, -140);
    sea.material = water;
    sea.parent = this.root;
    this.box("beach", [94, 1, 64], [0, -0.5, 19], sand, true);
    this.box("back-dunes", [94, 0.2, 13], [0, 0.02, 43], grass);
    // Hidden boundaries keep players on the shore during this introductory lesson.
    for (const [name, size, position] of [
      ["west-boundary", [1, 8, 65], [-46, 2, 19]],
      ["east-boundary", [1, 8, 65], [46, 2, 19]],
      ["north-boundary", [94, 8, 1], [0, 2, 50]],
      ["shore-left-boundary", [30, 8, 1], [-31, 2, -13]],
      ["shore-right-boundary", [59, 8, 1], [17.5, 2, -13]],
      ["pier-west-boundary", [0.2, 4, 19], [-16.2, 1, -21]],
      ["pier-east-boundary", [0.2, 4, 19], [-11.8, 1, -21]],
      ["pier-end-boundary", [4.5, 4, 0.2], [-14, 1, -30]],
    ] as Array<[string, number[], number[]]>) {
      this.box(name, size, position, sand, true).isVisible = false;
    }
    const path = this.material("path", "#e8d8b4");
    this.box("club-path", [6, 0.025, 32], [0, 0.02, 10], path);
    this.box("cross-path", [38, 0.025, 4], [0, 0.03, 5], path);

    // Club with porch; its occupied volume is a simple collider.
    this.box("club-house", [22, 5, 10], [0, 2.5, 25], white, true);
    this.box("club-roof", [24, 0.55, 12], [0, 5.25, 25], roof);
    this.box("club-porch", [24, 0.15, 4], [0, 0.075, 18], wood);
    this.box("club-door", [2, 3.5, 0.1], [0, 1.75, 19.94], navy);
    for (const x of [-7, 7]) this.box(`club-window-${x}`, [3.6, 2, 0.12], [x, 2.8, 19.9], navy);
    this.label("ПАРУСНЫЙ КЛУБ", new Vector3(0, 4.4, 19.7), 8, 0.9, false);

    // Open-air teaching area and equipment store.
    this.box("class-deck", [12, 0.12, 9], [14, 0.06, 13], wood);
    this.box("class-canopy", [13, 0.25, 10], [14, 4, 13], white);
    for (const x of [8, 20]) for (const z of [9, 17]) this.box("canopy-post", [0.15, 4, 0.15], [x, 2, z], navy, true);
    this.box("teaching-board", [5, 2.1, 0.2], [14, 2.25, 16], navy, true);
    this.label("УЧЕБНЫЙ ПРИЧАЛ\nВетер → галс → право пути", new Vector3(14, 2.3, 15.85), 4.7, 1.5, false);
    this.box("equipment-shed", [9, 3.6, 6], [23, 1.8, 3], navy, true);
    this.box("equipment-roof", [10, 0.3, 7], [23, 3.7, 3], roof);
    this.label("СНАРЯЖЕНИЕ", new Vector3(23, 3.1, -0.15), 5, 0.8, false);
    this.box("vest-rack", [3, 0.2, 0.5], [15, 2, 5], wood);
    this.box("rack-left", [0.12, 2, 0.12], [13.6, 1, 5], wood);
    this.box("rack-right", [0.12, 2, 0.12], [16.4, 1, 5], wood);
    const vestAnchor = new TransformNode("vest-station", scene);
    vestAnchor.parent = this.root;
    vestAnchor.position.set(15, 0, 5);
    const vestMeshes: Mesh[] = [];
    for (const x of [14.2, 15, 15.8]) {
      vestMeshes.push(this.box("orange-vest-left", [0.22, 0.85, 0.25], [x - 0.15, 1.45, 5], orange));
      vestMeshes.push(this.box("orange-vest-right", [0.22, 0.85, 0.25], [x + 0.15, 1.45, 5], orange));
    }
    this.stations.set("vest", { anchor: vestAnchor, meshes: vestMeshes });
    this.label("ЖИЛЕТЫ · E", new Vector3(15, 2.8, 5), 4, 0.7);

    const pole = this.cylinder("weather-mast", 6, 0.09, [-13, 3, 6], metal);
    pole.checkCollisions = false;
    this.flag = this.box("wind-flag", [2.5, 0.85, 0.035], [-11.7, 5.45, 6], orange);
    this.box("weather-desk", [3, 1, 1.2], [-10, 0.5, 7.3], white, true);
    this.label("МЕТЕОПОСТ", new Vector3(-10, 2.4, 7.3), 4, 0.7);

    // Walkable dock and a small training dinghy alongside it.
    this.box("pier-deck", [4, 0.3, 19], [-14, -0.15, -21], wood, true);
    for (const x of [-15.7, -12.3]) for (const z of [-13, -20, -28]) {
      this.cylinder("pier-post", 2.2, 0.23, [x, -0.5, z], wood);
    }
    this.label("УЧЕБНЫЙ ПИРС", new Vector3(-14, 2.8, -12), 5, 0.8);
    const hull = this.box("training-dinghy", [2.6, 0.6, 4.5], [-9.5, 0.1, -26], white);
    const bow = MeshBuilder.CreateCylinder("dinghy-bow", { height: 0.6, diameter: 2.6, tessellation: 3 }, scene);
    bow.position.set(-9.5, 0.1, -28);
    bow.material = white;
    bow.parent = this.root;
    this.cylinder("dinghy-mast", 6, 0.08, [-9.5, 3.1, -26], metal);
    const sail = MeshBuilder.CreateCylinder("training-sail", { height: 0.025, diameter: 5, tessellation: 3 }, scene);
    sail.rotation.z = Math.PI / 2;
    sail.rotation.y = Math.PI / 2;
    sail.scaling.set(0.85, 1, 1.2);
    sail.position.set(-9.5, 3.35, -25.2);
    sail.material = white;
    sail.parent = this.root;
    this.box("dinghy-boom", [0.08, 0.08, 3], [-9.5, 1.5, -24.8], wood);
    const pierAnchor = new TransformNode("pier-inspection", scene);
    pierAnchor.parent = this.root;
    pierAnchor.position.set(-14, 0, -26);
    this.stations.set("pier", { anchor: pierAnchor, meshes: [hull, sail] });
    this.label("ОСМОТР ЛОДКИ · E", new Vector3(-10, 6.6, -26), 5, 0.8);

    // Sparse shoreline details and distant buoys keep the horizon readable.
    const foam = this.material("foam", "#c4e8dc");
    for (let i = 0; i < 6; i++) this.box("wave", [12 + i * 3, 0.018, 0.09], [i * 16 - 40, -0.28, -18 - (i % 3) * 5], foam);
    for (const [x, z] of [[-30, -40], [8, -48], [30, -30]]) {
      this.cylinder("buoy", 0.8, 0.8, [x!, 0.1, z!], orange);
    }
    for (const x of [-26, 28]) {
      this.box("bench-seat", [3.3, 0.15, 0.7], [x, 0.65, 13], wood);
      for (const offset of [-1.2, 1.2]) this.box("bench-leg", [0.15, 0.6, 0.5], [x + offset, 0.3, 13], navy);
    }
    this.label("ПЕРВЫЙ ДЕНЬ В АКАДЕМИИ", new Vector3(0, 2.5, -5), 6, 0.8);

    for (const npc of SHORE_NPCS) this.createNpc(npc);
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

  public update(delta: number): void {
    this.time += Math.min(delta, 0.1);
    this.marker.rotation.y = this.time;
    this.marker.position.y = 3.5 + Math.sin(this.time * 2) * 0.18;
    this.flag.rotation.y = Math.sin(this.time * 3) * 0.1;
  }

  public dispose(): void {
    this.root.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.materials.forEach((material) => material.dispose());
  }

  private createNpc(npc: typeof SHORE_NPCS[number]): void {
    const anchor = new TransformNode(`npc-${npc.id}`, this.scene);
    anchor.parent = this.root;
    anchor.position.set(npc.x, 0, npc.z);
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
    this.label(npc.name, new Vector3(npc.x, 2.5, npc.z), 3.1, 0.45);
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
    const texture = new DynamicTexture(`label-${text}`, { width: 1024, height: 256 }, this.scene, false);
    const ctx = texture.getContext();
    ctx.fillStyle = "rgba(17, 43, 54, 0.91)";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = "#f4e7c8";
    ctx.font = "bold 52px Arial";
    const lines = text.split("\n");
    lines.forEach((line, i) => ctx.fillText(line, (1024 - ctx.measureText(line).width) / 2, lines.length === 1 ? 147 : 95 + i * 80));
    texture.update();
    const material = this.material(`label-material-${text}`, "#ffffff");
    material.diffuseTexture = texture;
    material.emissiveColor.set(1, 1, 1);
    material.disableLighting = true;
    material.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane(`label-plane-${text}`, { width, height }, this.scene);
    plane.position.copyFrom(position);
    plane.material = material;
    plane.isPickable = false;
    plane.parent = this.root;
    if (billboard) plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.textures.push(texture);
  }
}
