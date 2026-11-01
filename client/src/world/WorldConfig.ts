import defaults from "../../../shared/world/hub.json";
export type Vec3 = [number, number, number];
export interface NpcConfig { id: string; name: string; role: string; color: string; x: number; z: number; skin: string }
export interface WorldConfig {
  version: number;
  player: { walkSpeed: number; runSpeed: number; acceleration: number; braking: number; gravity: number; turnSpeed: number };
  camera: { distance: number; minDistance: number; maxDistance: number; height: number; beta: number; followSpeed: number; manualDelay: number };
  environment: { sky: string; fogStart: number; fogEnd: number; lightIntensity: number; sea: { width: number; height: number; position: Vec3 }; materials: Record<string, string> };
  boxes: Array<{ name: string; size: Vec3; position: Vec3; material: string; collision: boolean; visible: boolean }>;
  cylinders: Array<{ name: string; height: number; diameter: number; position: Vec3; material: string }>;
  labels: Array<{ text: string; position: Vec3; width: number; height: number; billboard: boolean }>;
  npcs: NpcConfig[];
  stations: { vest: Vec3; pier: Vec3 };
  props: Array<[string, number, number, number]>;
  special: { bow: {position: Vec3; height: number; diameter: number}; sail: {position: Vec3; scale: Vec3; diameter: number} };
}
export interface WorldResponse { world: WorldConfig; revision: string }
export const DEFAULT_WORLD = defaults as unknown as WorldConfig;
export async function fetchWorld(baseUrl = ""): Promise<WorldResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/world`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Не удалось загрузить мир (${response.status})`);
  return response.json() as Promise<WorldResponse>;
}
