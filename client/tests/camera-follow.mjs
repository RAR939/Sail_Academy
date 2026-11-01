// Run with: node --experimental-transform-types tests/camera-follow.mjs
import assert from "node:assert/strict";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CameraRig } from "../src/gameplay/CameraRig.ts";

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
document.pointerLockElement = null;
const canvas = new EventTarget();
canvas.hasPointerCapture = () => false;
const engine = new NullEngine();
const scene = new Scene(engine);
const rig = new CameraRig(scene, canvas, { alpha: 0, manualDelay: 1.25 });
rig.setTarget(new TransformNode("player", scene));
scene.activeCamera = rig.camera;

// A direction fluctuating around the +/-π boundary must not alternate sides.
let sign = 0;
for (let frame = 0; frame < 180; frame++) {
  const before = rig.camera.alpha;
  rig.update(1 / 60, false, new Vector3(1, 0, frame % 2 ? 0.002 : -0.002));
  const step = rig.camera.alpha - before;
  assert.ok(Math.abs(step) <= 2.4 / 60 + 1e-8, "automatic rotation must be rate-limited");
  if (frame < 30 && Math.abs(step) > 1e-6) {
    sign ||= Math.sign(step);
    assert.equal(Math.sign(step), sign, "the 180-degree turn must keep its direction");
  }
}
assert.ok(Math.abs(Math.abs(rig.camera.alpha) - Math.PI) < 0.1, "camera should settle behind the player");

// Auto-follow may turn the view, but holding a movement key keeps its course.
rig.setMovementAxes(0, 1);
const basis = rig.getMovementBasis().forward.clone();
for (let frame = 0; frame < 120; frame++) rig.update(1 / 60, false, new Vector3(0, 0, 1));
assert.ok(Vector3.Distance(basis, rig.getMovementBasis().forward) < 1e-6);

// Manual mouse look takes priority; auto-follow waits before resuming.
document.pointerLockElement = canvas;
const pointer = new Event("pointermove");
Object.defineProperties(pointer, { movementX: { value: 20 }, movementY: { value: 0 } });
window.dispatchEvent(pointer);
const afterMouse = rig.camera.alpha;
for (let frame = 0; frame < 45; frame++) rig.update(1 / 60, false, new Vector3(1, 0, 0));
assert.ok(Math.abs(rig.camera.alpha - afterMouse) < 1e-8, "manual look must not be overridden");

// Entering and leaving occlusion should move the radius progressively.
document.pointerLockElement = null;
scene.pickWithRay = () => ({ hit: true, distance: 1.5 });
rig.camera.radius = 5;
rig.update(1 / 60, false, Vector3.Zero());
assert.ok(rig.camera.radius < 5 && rig.camera.radius > 1.25, "occlusion must not snap in one frame");
for (let frame = 0; frame < 30; frame++) rig.update(1 / 60, false, Vector3.Zero());
assert.ok(Math.abs(rig.camera.radius - 1.25) < 0.01);
scene.pickWithRay = () => null;
rig.update(1 / 60, false, Vector3.Zero());
assert.ok(rig.camera.radius > 1.25 && rig.camera.radius < 2, "leaving occlusion must ease out");
rig.dispose();
engine.dispose();
console.log("Camera follow, reversal, manual look and occlusion: OK");
