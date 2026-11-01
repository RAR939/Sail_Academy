import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";

import { LoadAssetContainerAsync } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { sailSideForWind } from "../gameplay/WindVisual";

export const BOAT_PARTS = [
  { id: "hull", title: "Корпус и кокпит", text: "Корпус удерживает лодку на плаву. Нос находится впереди, корма — сзади. В кокпите сидит рулевой; борта помогают удерживать воду снаружи." },
  { id: "mast", title: "Мачта", text: "Мачта поддерживает парус. У ILCA она состоит из двух секций и устанавливается в стакан на палубе." },
  { id: "sail", title: "Парус", text: "Грот — единственный парус ILCA. Поток воздуха создаёт силу, которая вместе со швертом позволяет двигаться под углом к ветру." },
  { id: "boom", title: "Гик и гика-шкот", text: "Гик удерживает нижнюю кромку паруса. Шкотом рулевой меняет угол гика и паруса относительно корпуса." },
  { id: "rudder", title: "Руль и румпель", text: "Перо руля поворачивает лодку; румпель соединён с ним и находится в руке рулевого. Румпель перемещают в сторону, противоположную желаемому повороту носа." },
  { id: "centreboard", title: "Шверт", text: "Опускной шверт уменьшает боковой снос и помогает идти к ветру. На мелководье его поднимают, не касаясь дна." },
] as const;
export type BoatPart = typeof BOAT_PARTS[number]["id"];

/** An original, approximate ILCA-style dinghy, separated into animated assemblies. */
export class TrainingDinghy {
  public readonly root: TransformNode;
  public readonly parts = new Map<BoatPart, Mesh[]>();
  private readonly mats: StandardMaterial[] = [];
  private readonly sailRig: TransformNode;
  private readonly rudderRig: TransformNode;
  private readonly board: Mesh;
  private sailSide = 1;
  private targetSail = 0.22;
  private targetRudder = 0;
  private boardRaised = false;
  private disposed = false;
  public onModelLoaded: (() => void) | null = null;

  constructor(private scene: Scene, parent: TransformNode) {
    this.root = new TransformNode("ilca-training-boat", scene);
    this.root.parent = parent;
    this.root.position.set(-9.5, 0.03, -26);
    const hullMat = this.mat("hull", "#e6e8e2");
    const deckMat = this.mat("deck", "#f8f7ed");
    const dark = this.mat("hardware", "#35454b");
    const spar = this.mat("spar", "#a8b2b2");
    const cloth = this.mat("sail", "#f5f2e7");
    cloth.backFaceCulling = false;
    const red = this.mat("rope", "#bd4938");

    // Cross-sections: bow (negative z), midships, transom. Approx. 4.2 m long.
    const positions = [0,0.28,-2.15, -0.46,0.42,-1.25, -0.68,0.43,0.3, -0.55,0.4,1.9,
      0.55,0.4,1.9, 0.68,0.43,0.3, 0.46,0.42,-1.25,
      0,0.02,-1.85, -0.25,-0.18,-0.75, -0.36,-0.22,0.65, -0.35,-0.12,1.9,
      0.35,-0.12,1.9, 0.36,-0.22,0.65, 0.25,-0.18,-0.75];
    const indices = [0,1,7,1,8,7,1,2,8,2,9,8,2,3,9,3,10,9,3,4,10,4,11,10,4,5,11,5,12,11,5,6,12,6,13,12,6,0,13,0,7,13,7,8,13,8,12,13,8,9,12,9,11,12,9,10,11,0,6,1,1,6,2,2,6,5,2,5,3,3,5,4];
    const hull = new Mesh("ilca-hull", scene);
    const data = new VertexData(); data.positions = positions; data.indices = indices;
    const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals); data.normals = normals; data.applyToMesh(hull);
    hull.parent = this.root; hull.material = hullMat; this.add("hull", hull);
    const cockpit = this.box("cockpit", [0.78, 0.06, 1.75], [0,0.44,0.72], dark, this.root); this.add("hull", cockpit);
    this.add("hull", this.box("cockpit-floor", [0.62,0.04,1.45], [0,0.47,0.75], deckMat, this.root));
    for (const x of [-0.58,0.58]) this.add("hull", this.box("side-deck", [0.12,0.08,2.5], [x,0.45,0.45], deckMat, this.root));
    this.add("mast", this.cylinder("mast-lower", 3.05, 0.09, [0,1.9,-0.93], spar, this.root));
    this.add("mast", this.cylinder("mast-upper", 2.95, 0.06, [0,4.85,-0.93], spar, this.root));
    this.sailRig = new TransformNode("sail-and-boom", scene); this.sailRig.parent = this.root; this.sailRig.position.set(0,0,-0.93);
    for (const mast of this.parts.get("mast") ?? []) {
      mast.parent = this.sailRig;
      mast.position.z += 0.93;
    }
    const sail = new Mesh("mainsail", scene);
    const sailData = new VertexData();
    sailData.positions = [0,0.91,0, 0,5.93,0, 0,1.12,2.73, 0,3.65,1.42];
    sailData.indices = [0,1,3,0,3,2];
    const sailNormals: number[] = []; VertexData.ComputeNormals(sailData.positions,sailData.indices,sailNormals); sailData.normals=sailNormals; sailData.applyToMesh(sail);
    sail.parent = this.sailRig; sail.material = cloth; this.add("sail", sail);
    const boom = this.box("boom", [0.09,0.09,2.85], [0,1.02,1.37], spar, this.sailRig); this.add("boom", boom);
    const sheet = MeshBuilder.CreateLines("mainsheet", {points:[new Vector3(0,1,2.15),new Vector3(0,0.47,1.2),new Vector3(0,0.8,1.0)]}, scene);
    sheet.color = Color3.FromHexString("#bd4938"); sheet.parent = this.sailRig; this.add("boom", sheet);
    this.rudderRig = new TransformNode("rudder-assembly", scene); this.rudderRig.parent = this.root; this.rudderRig.position.set(0,0.3,1.94);
    this.add("rudder", this.box("rudder-blade", [0.08,0.9,0.35], [0,-0.28,0.12], dark, this.rudderRig));
    this.add("rudder", this.box("tiller", [0.08,0.08,1.35], [0,0.2,-0.58], spar, this.rudderRig));
    this.board = this.box("centreboard", [0.08,0.85,0.42], [0,0.11,-0.06], dark, this.root); this.add("centreboard", this.board);
    this.box("mast-collar", [0.24,0.05,0.24], [0,0.49,-0.93], red, this.root);
    void this.loadModel();
  }
  public select(id: BoatPart): void {
    if (id === "sail" || id === "boom") this.targetSail = this.targetSail > 0.3 ? -0.55 : 0.55;
    if (id === "rudder") this.targetRudder = this.targetRudder > 0 ? -0.45 : 0.45;
    if (id === "centreboard") this.boardRaised = !this.boardRaised;
  }
  public update(dt: number): void {
    const blend = Math.min(1, Math.max(0,dt) * 3);
    this.sailRig.rotation.y += (this.targetSail - this.sailRig.rotation.y) * blend;
    this.rudderRig.rotation.y += (this.targetRudder - this.rudderRig.rotation.y) * blend;
    const y = this.boardRaised ? 0.65 : 0.11;
    this.board.position.y += (y - this.board.position.y) * blend;
  }
  /** Heading and windDirection are world angles; windDirection is where wind comes from. */
  public setSailingState(sheetAngle: number, windDirection: number, heading: number): void {
    // A little hysteresis prevents the boom switching sides on every snapshot.
    this.sailSide = sailSideForWind(windDirection, heading, this.sailSide);
    this.targetSail = Math.max(0, Math.min(Math.PI / 2, sheetAngle)) * this.sailSide;
  }
  public dispose(): void { this.disposed = true; this.root.dispose(); this.mats.forEach((m) => m.dispose()); }
  private async loadModel(): Promise<void> {
    try {
      const container = await LoadAssetContainerAsync("/assets/glb/boats/laser47.glb", this.scene);
      if (this.disposed) { container.dispose(); return; }
      const loaded = container.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && /^(hull|mast|sail|boom|rudder|centreboard)_\d+$/.test(mesh.name));
      if (loaded.length !== 24) { container.dispose(); throw new Error("Неполная модель Laser"); }
      container.addAllToScene();
      for (const meshes of this.parts.values()) for (const mesh of meshes) mesh.isVisible = false;
      this.parts.clear();
      // The luff/boom attach around z=-0.82 in the converted Laser mesh.
      this.sailRig.position.set(0.05, 0, -0.82);
      this.rudderRig.position.z = 2.26;
      const white = this.mat("laser-white", "#efefea");
      const canvas = this.mat("laser-sail", "#f6f4e9"); canvas.backFaceCulling = false;
      const black = this.mat("laser-hardware", "#303a3e");
      const aluminium = this.mat("laser-spars", "#a6adb0");
      for (const mesh of loaded) {
        const id = mesh.name.split("_")[0] as BoatPart;
        mesh.material = id === "sail" ? canvas : id === "mast" || id === "boom" ? aluminium : id === "rudder" || id === "centreboard" ? black : white;
        if (id === "sail" || id === "boom" || id === "mast") {
          mesh.parent = this.sailRig; mesh.position.set(-0.05, 0, 0.82);
        } else if (id === "rudder") {
          mesh.parent = this.rudderRig; mesh.position.set(0, -0.3, -2.26);
        } else if (id === "centreboard") {
          mesh.parent = this.board; mesh.position.set(0, -0.11, 0.06);
        } else {
          mesh.parent = this.root; mesh.position.setAll(0);
        }
        this.add(id, mesh);
      }
      this.onModelLoaded?.();
    } catch (error) {
      console.warn("Не удалось загрузить модель Laser; используется учебная модель", error);
    }
  }
  private add(id: BoatPart, mesh: Mesh): void { const group=this.parts.get(id) ?? []; group.push(mesh); this.parts.set(id,group); }
  private mat(name: string, color: string): StandardMaterial { const m=new StandardMaterial(`ilca-${name}`,this.scene); m.diffuseColor=Color3.FromHexString(color); m.specularColor.set(0.13,0.13,0.13); this.mats.push(m); return m; }
  private box(name: string, size: number[], pos: number[], mat: StandardMaterial, parent: TransformNode): Mesh { const m=MeshBuilder.CreateBox(name,{width:size[0]!,height:size[1]!,depth:size[2]!},this.scene); m.parent=parent; m.position.set(pos[0]!,pos[1]!,pos[2]!); m.material=mat; return m; }
  private cylinder(name: string, height: number, diameter: number, pos: number[], mat: StandardMaterial, parent: TransformNode): Mesh { const m=MeshBuilder.CreateCylinder(name,{height,diameter,tessellation:12},this.scene); m.parent=parent; m.position.set(pos[0]!,pos[1]!,pos[2]!); m.material=mat; return m; }
}
