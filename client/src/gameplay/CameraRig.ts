import { ArcRotateCamera, Ray, Scalar, Scene, TransformNode, Vector3 } from "@babylonjs/core";

export interface CameraRigConfig {
  alpha?: number;
  beta?: number;
  radius?: number;
  targetHeight?: number;
  minRadius?: number;
  maxRadius?: number;
  followSpeed?: number;
  manualDelay?: number;
}

export interface CameraMovementBasis { forward: Vector3; right: Vector3 }

/** Third-person camera: click to look around, Esc to release, or drag with RMB. */
export class CameraRig {
  public readonly camera: ArcRotateCamera;
  private target: TransformNode | null = null;
  private readonly targetHeight: number;
  private readonly minRadius: number;
  private readonly maxRadius: number;
  private readonly followSpeed: number;
  private readonly manualDelay: number;
  private desiredRadius: number;
  // Keep the movement heading stable while automatic camera rotation catches up.
  private movementAlpha: number;
  private forwardAxis = 0;
  private rightAxis = 0;
  private manualLookDelay = 0;
  private readonly smoothedMovement = Vector3.Zero();
  private autoTurnVelocity = 0;
  private turnaroundSide = 0;
  private enabled = true;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.button === 0 && document.pointerLockElement !== this.canvas) {
      // Pointer lock is requested only by an explicit click on the game canvas.
      try {
        const result = this.canvas.requestPointerLock();
        if (result && typeof result.catch === "function") void result.catch(() => {});
      } catch { /* RMB dragging remains available if pointer lock is unavailable. */ }
      return;
    }
    if (event.button !== 2 || document.pointerLockElement === this.canvas) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.manualLookDelay = this.manualDelay;
    this.canvas.setPointerCapture(event.pointerId);
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    let dx: number, dy: number;
    if (document.pointerLockElement === this.canvas) {
      dx = event.movementX; dy = event.movementY;
    } else if (event.pointerId === this.activePointerId) {
      dx = event.clientX - this.lastPointerX;
      dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX; this.lastPointerY = event.clientY;
    } else return;
    if (dx !== 0 || dy !== 0) {
      this.manualLookDelay = this.manualDelay;
      this.autoTurnVelocity = 0;
      this.turnaroundSide = 0;
    }
    const yawChange = -dx * 0.0035;
    this.camera.alpha += yawChange;
    this.movementAlpha += yawChange;
    this.camera.beta = Scalar.Clamp(this.camera.beta - dy * 0.0035, 0.45, 1.43);
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.stopManualOrbit();
  };
  private readonly onPointerCancel = (): void => this.stopManualOrbit();
  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.desiredRadius = Scalar.Clamp(this.desiredRadius + event.deltaY * 0.004, this.minRadius, this.maxRadius);
  };
  private readonly preventContextMenu = (event: MouseEvent): void => event.preventDefault();
  private readonly onBlur = (): void => this.stopManualOrbit();

  constructor(private readonly scene: Scene, private readonly canvas: HTMLCanvasElement, config: CameraRigConfig = {}) {
    this.targetHeight = config.targetHeight ?? 0.55;
    this.followSpeed = config.followSpeed ?? 2.2;
    this.manualDelay = config.manualDelay ?? 1.25;
    this.minRadius = config.minRadius ?? 2.6;
    this.maxRadius = config.maxRadius ?? 8;
    this.desiredRadius = Scalar.Clamp(config.radius ?? 5.2, this.minRadius, this.maxRadius);
    this.camera = new ArcRotateCamera("third-person-camera", config.alpha ?? -Math.PI / 2, config.beta ?? 1.18, this.desiredRadius, Vector3.Zero(), scene);
    this.movementAlpha = this.camera.alpha;
    this.camera.lowerBetaLimit = 0.45;
    this.camera.upperBetaLimit = 1.43;
    // The camera may come closer than the user's zoom setting to clear walls.
    this.camera.lowerRadiusLimit = 0.45;
    this.camera.upperRadiusLimit = this.maxRadius;
    this.camera.fov = 0.85;
    this.camera.minZ = 0.08;
    this.camera.inertia = 0;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
    window.addEventListener("blur", this.onBlur);
  }

  public setTarget(target: TransformNode): void { this.target = target; this.snapToTarget(); }
  public snapToTarget(): void {
    if (this.target) this.camera.setTarget(this.getDesiredTargetPosition());
  }
  public update(deltaSeconds: number, isRunning: boolean, movementDirection: Vector3): void {
    if (!this.target) return;
    const delta = Scalar.Clamp(deltaSeconds, 0, 0.05);
    this.manualLookDelay = Math.max(0, this.manualLookDelay - delta);
    // Use measured movement, but filter collision jitter and near-zero speeds.
    Vector3.LerpToRef(this.smoothedMovement, movementDirection, 1 - Math.exp(-10 * delta), this.smoothedMovement);
    const moving = movementDirection.lengthSquared() > 0.35 * 0.35 && this.smoothedMovement.lengthSquared() > 0.2 * 0.2;
    if (this.enabled && this.activePointerId === null && this.manualLookDelay === 0 && moving) {
      const desiredAlpha = Math.atan2(-this.smoothedMovement.z, -this.smoothedMovement.x);
      let angle = Math.atan2(Math.sin(desiredAlpha - this.camera.alpha), Math.cos(desiredAlpha - this.camera.alpha));
      // At 180 degrees both routes are equally short. Keep the chosen side
      // until the camera has left that region, even if movement jitters.
      if (Math.abs(angle) > Math.PI - 0.25) {
        if (this.turnaroundSide === 0) {
          this.turnaroundSide = Math.abs(this.autoTurnVelocity) > 0.1
            ? Math.sign(this.autoTurnVelocity) : Math.sign(angle) || 1;
        }
        if (Math.sign(angle) !== this.turnaroundSide) angle += this.turnaroundSide * Math.PI * 2;
      } else {
        this.turnaroundSide = 0;
      }
      const desiredVelocity = Scalar.Clamp(angle * this.followSpeed, -2.4, 2.4);
      this.autoTurnVelocity = Scalar.Lerp(this.autoTurnVelocity, desiredVelocity, 1 - Math.exp(-10 * delta));
      let step = this.autoTurnVelocity * delta;
      if (Math.sign(step) === Math.sign(angle) && Math.abs(step) >= Math.abs(angle)) {
        step = angle;
        this.autoTurnVelocity = 0;
      }
      this.camera.alpha += step;
    } else {
      this.autoTurnVelocity = 0;
      this.turnaroundSide = 0;
    }
    const target = this.getDesiredTargetPosition();
    Vector3.LerpToRef(this.camera.target, target, 1 - Math.exp(-12 * delta), this.camera.target);
    const sinBeta = Math.sin(this.camera.beta);
    let unobstructed = this.desiredRadius;
    // Look slightly to either side as well, so a thin post is detected before
    // the camera's centre crosses it during a fast orbit.
    for (const angleOffset of [-0.07, 0, 0.07]) {
      const angle = this.camera.alpha + angleOffset;
      const offset = new Vector3(Math.cos(angle) * sinBeta, Math.cos(this.camera.beta), Math.sin(angle) * sinBeta);
      const ray = new Ray(this.camera.target, offset, this.desiredRadius);
      const hit = this.scene.pickWithRay(ray, mesh => mesh.isEnabled() && mesh.isVisible && mesh.checkCollisions && !mesh.metadata?.ignoreCameraCollision && mesh !== this.target);
      if (hit?.hit) unobstructed = Math.min(unobstructed, Math.max(0.45, hit.distance - 0.25));
    }
    // A short inward ease prevents a one-frame zoom jump; exit remains slower.
    const radiusSpeed = unobstructed < this.camera.radius ? 24 : 7;
    this.camera.radius = Scalar.Lerp(this.camera.radius, unobstructed, 1 - Math.exp(-radiusSpeed * delta));
    this.camera.fov = Scalar.Lerp(this.camera.fov, isRunning ? 0.90 : 0.85, 1 - Math.exp(-4 * delta));
  }
  public setMovementAxes(forward: number, right: number): void {
    if (forward !== this.forwardAxis || right !== this.rightAxis) {
      this.movementAlpha = this.camera.alpha;
      this.forwardAxis = forward;
      this.rightAxis = right;
    }
  }
  public getMovementBasis(): CameraMovementBasis {
    const forward = new Vector3(-Math.cos(this.movementAlpha), 0, -Math.sin(this.movementAlpha));
    return { forward, right: Vector3.Cross(Vector3.Up(), forward).normalize() };
  }
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopManualOrbit();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }
  public dispose(): void {
    this.setEnabled(false);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
    window.removeEventListener("blur", this.onBlur);
    this.camera.dispose();
  }
  private stopManualOrbit(): void {
    if (this.activePointerId !== null && this.canvas.hasPointerCapture(this.activePointerId)) this.canvas.releasePointerCapture(this.activePointerId);
    this.activePointerId = null;
  }
  private getDesiredTargetPosition(): Vector3 {
    return this.target!.getAbsolutePosition().add(new Vector3(0, this.targetHeight, 0));
  }
}
