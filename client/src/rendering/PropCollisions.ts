import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { SpawnedAsset } from "./AssetLoader";

/** Invisible collision geometry for a placed prop. Palms collide with the trunk, not the leaves. */
export function createPropCollider(
  scene: Scene,
  asset: SpawnedAsset,
  parent: TransformNode,
  path: string,
  x: number,
  z: number,
  scale: number,
): Mesh | null {
  let collider: Mesh;
  if (path.startsWith("environment/tree_palm_")) {
    const height = 0.95 * scale;
    collider = MeshBuilder.CreateCylinder(`collider-${path}`, {
      height,
      diameter: 0.16 * scale,
      tessellation: 12,
    }, scene);
    collider.position.set(x, height / 2, z);
  } else {
    const minimum = new Vector3(Infinity, Infinity, Infinity);
    const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    let hasGeometry = false;
    for (const root of asset.roots) {
      root.computeWorldMatrix(true);
      for (const mesh of root.getChildMeshes()) {
        if (!mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        minimum.minimizeInPlace(box.minimumWorld);
        maximum.maximizeInPlace(box.maximumWorld);
        hasGeometry = true;
      }
    }
    if (!hasGeometry) return null;
    const size = maximum.subtract(minimum);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
    // The player's collision ellipsoid otherwise rolls over low props instead of
    // stopping at their sides. Extend only the invisible collision volume upward.
    const height = Math.max(size.y, 1.5);
    collider = MeshBuilder.CreateBox(`collider-${path}`, { width: size.x, height, depth: size.z }, scene);
    collider.position.set((minimum.x + maximum.x) / 2, minimum.y + height / 2, (minimum.z + maximum.z) / 2);
    // A short rock should not pull the camera in from above its visible top.
    collider.metadata = { ignoreCameraCollision: size.y < 1.5 };
  }
  collider.parent = parent;
  collider.checkCollisions = true;
  // Keep it in camera obstruction raycasts while rendering it fully transparent.
  collider.visibility = 0;
  collider.isPickable = false;
  collider.freezeWorldMatrix();
  return collider;
}
