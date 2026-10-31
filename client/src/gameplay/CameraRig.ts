import {
  ArcRotateCamera,
  Scalar,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface CameraRigConfig {
  alpha?: number;
  beta?: number;
  radius?: number;
  targetHeight?: number;
  minRadius?: number;
  maxRadius?: number;
}

export interface CameraMovementBasis {
  forward: Vector3;
  right: Vector3;
}

export class CameraRig {
  public readonly camera: ArcRotateCamera;

  private target: TransformNode | null = null;
  private readonly targetHeight: number;
  private readonly minRadius: number;
  private readonly maxRadius: number;

  private enabled = true;
  private isManualOrbiting = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 2) {
      return;
    }

    event.preventDefault();

    this.isManualOrbiting = true;
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (
      !this.enabled ||
      !this.isManualOrbiting ||
      event.pointerId !== this.activePointerId
    ) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;

    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    const sensitivity = 0.004;

    this.camera.alpha -= deltaX * sensitivity;
    this.camera.beta = Scalar.Clamp(
      this.camera.beta - deltaY * sensitivity,
      this.camera.lowerBetaLimit ?? 0.25,
      this.camera.upperBetaLimit ?? Math.PI / 2.05,
    );
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) {
      this.stopManualOrbit();
    }
  };

  private readonly onPointerCancel = (): void => {
    this.stopManualOrbit();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) {
      return;
    }

    event.preventDefault();

    this.camera.radius = Scalar.Clamp(
      this.camera.radius + event.deltaY * 0.005,
      this.minRadius,
      this.maxRadius,
    );
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  public constructor(
    scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    config: CameraRigConfig = {},
  ) {
    this.targetHeight = config.targetHeight ?? 1.15;
    this.minRadius = config.minRadius ?? 2.8;
    this.maxRadius = config.maxRadius ?? 8;

    this.camera = new ArcRotateCamera(
      "third-person-camera",
      config.alpha ?? -Math.PI / 2,
      config.beta ?? Math.PI / 3,
      config.radius ?? 5.5,
      Vector3.Zero(),
      scene,
    );

    this.camera.lowerBetaLimit = 0.25;
    this.camera.upperBetaLimit = Math.PI / 2.05;
    this.camera.lowerRadiusLimit = this.minRadius;
    this.camera.upperRadiusLimit = this.maxRadius;
    this.camera.panningSensibility = 0;
    this.camera.inertia = 0;

    this.camera.checkCollisions = true;
    this.camera.collisionRadius = new Vector3(0.35, 0.35, 0.35);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  public setTarget(target: TransformNode): void {
    this.target = target;
    this.camera.setTarget(this.getDesiredTargetPosition());
  }

  public update(_deltaSeconds: number, _isPlayerMoving: boolean): void {
    if (!this.target) {
      return;
    }

    // Камера следует за игроком, но не меняет угол обзора сама.
    this.camera.target.copyFrom(this.getDesiredTargetPosition());
  }

  public getMovementBasis(): CameraMovementBasis {
    const forward = this.camera.getForwardRay().direction.clone();
    forward.y = 0;

    if (forward.lengthSquared() < 0.0001) {
      forward.set(0, 0, 1);
    } else {
      forward.normalize();
    }

    return {
      forward,
      right: Vector3.Cross(Vector3.Up(), forward).normalize(),
    };
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.stopManualOrbit();
    }
  }

  public dispose(): void {
    this.stopManualOrbit();

    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);

    this.camera.dispose();
  }

  private stopManualOrbit(): void {
    if (
      this.activePointerId !== null &&
      this.canvas.hasPointerCapture(this.activePointerId)
    ) {
      this.canvas.releasePointerCapture(this.activePointerId);
    }

    this.isManualOrbiting = false;
    this.activePointerId = null;
  }

  private getDesiredTargetPosition(): Vector3 {
    if (!this.target) {
      return Vector3.Zero();
    }

    return this.target
      .getAbsolutePosition()
      .add(new Vector3(0, this.targetHeight, 0));
  }
}