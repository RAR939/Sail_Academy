import {
  AnimationGroup,
  Color3,
  Mesh,
  MeshBuilder,
  Scalar,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

export type PlayerAnimation = "idle" | "walk" | "run" | "interact";

export interface PlayerInput {
  /** Направление уже переведено обработчиком ввода в мировые координаты. */
  moveX: number;
  moveZ: number;
  run: boolean;
  interactPressed: boolean;
}

export interface PlayerConfig {
  id: string;
  spawn: Vector3;
  walkSpeed?: number;
  runSpeed?: number;
  capsuleHeight?: number;
  capsuleRadius?: number;
}

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  animation: PlayerAnimation;
}

/**
 * Локально управляемый персонаж.
 * Для работы столкновений сцена должна иметь scene.collisionsEnabled = true.
 */
export class Player {
  public readonly id: string;
  public readonly collider: Mesh;
  public readonly visual: Mesh;

  private readonly walkSpeed: number;
  private readonly runSpeed: number;
  private readonly gravity = -24;
  private readonly animationGroups = new Map<PlayerAnimation, AnimationGroup>();

  private input: PlayerInput = {
    moveX: 0,
    moveZ: 0,
    run: false,
    interactPressed: false,
  };

  private verticalVelocity = 0;
  private currentAnimation: PlayerAnimation = "idle";
  private interactionRequested = false;
  private interactionWasPressed = false;
  private interactionTimeLeft = 0;


  public constructor(scene: Scene, config: PlayerConfig) {
    this.id = config.id;
    this.walkSpeed = config.walkSpeed ?? 3.3;
    this.runSpeed = config.runSpeed ?? 6.2;

    const height = config.capsuleHeight ?? 1.8;
    const radius = config.capsuleRadius ?? 0.38;

    this.collider = MeshBuilder.CreateCapsule(
      `player-collider-${config.id}`,
      {
        height,
        radius,
        tessellation: 12,
      },
      scene,
    );

    this.collider.position.copyFrom(config.spawn);
    this.collider.checkCollisions = true;
    this.collider.isVisible = false;
    this.collider.ellipsoid = new Vector3(radius, height * 0.48, radius);

    // Временная визуализация: будет заменена GLB-персонажем в AssetLoader.
    this.visual = MeshBuilder.CreateCapsule(
      `player-visual-${config.id}`,
      {
        height,
        radius: radius * 0.92,
        tessellation: 12,
      },
      scene,
    );

    this.visual.parent = this.collider;
    this.visual.isPickable = false;

    const material = new StandardMaterial(`player-material-${config.id}`, scene);
    material.diffuseColor = new Color3(0.16, 0.42, 0.82);
    this.visual.material = material;
  }

  public setInput(input: PlayerInput): void {
    this.input = input;

    if (input.interactPressed && !this.interactionWasPressed) {
      this.interactionRequested = true;
    }

    this.interactionWasPressed = input.interactPressed;
  }

  public update(deltaSeconds: number): void {
    const delta = Scalar.Clamp(deltaSeconds, 0, 0.05);

    if (this.interactionTimeLeft > 0) {
      this.interactionTimeLeft -= delta;
      if (this.interactionTimeLeft <= 0) {
        this.setAnimation("idle");
      }
      return;
    }

    const direction = new Vector3(this.input.moveX, 0, this.input.moveZ);
    const hasMovement = direction.lengthSquared() > 0.0001;

    if (hasMovement) {
      direction.normalize();

      const targetYaw = Math.atan2(direction.x, direction.z);
      this.collider.rotation.y = Scalar.LerpAngle(
        this.collider.rotation.y,
        targetYaw,
        Math.min(1, delta * 14),
      );
    }

    const speed = this.input.run ? this.runSpeed : this.walkSpeed;
    const horizontalMovement = hasMovement
      ? direction.scale(speed * delta)
      : Vector3.Zero();

    this.verticalVelocity += this.gravity * delta;

    const movement = new Vector3(
      horizontalMovement.x,
      this.verticalVelocity * delta,
      horizontalMovement.z,
    );

    const yBeforeMove = this.collider.position.y;
    this.collider.moveWithCollisions(movement);
    const actualVerticalMove = this.collider.position.y - yBeforeMove;

    // Если падение было остановлено поверхностью, сбрасываем скорость вниз.
    if (
      movement.y < 0 &&
      actualVerticalMove > movement.y + 0.002
    ) {
      this.verticalVelocity = 0;
    }

    if (!hasMovement) {
      this.setAnimation("idle");
    } else {
      this.setAnimation(this.input.run ? "run" : "walk");
    }
  }

  public consumeInteractionRequest(): boolean {
    const requested = this.interactionRequested;
    this.interactionRequested = false;
    return requested;
  }

  public playInteraction(durationSeconds = 0.65): void {
    this.interactionTimeLeft = durationSeconds;
    this.setAnimation("interact");
  }

  public setPosition(position: Vector3): void {
    this.collider.position.copyFrom(position);
    this.verticalVelocity = 0;
  }

  public getSnapshot(): PlayerSnapshot {
    return {
      id: this.id,
      x: this.collider.position.x,
      y: this.collider.position.y,
      z: this.collider.position.z,
      yaw: this.collider.rotation.y,
      animation: this.currentAnimation,
    };
  }

  /**
   * Вызывается после загрузки GLB-модели.
   * Ключи должны быть именами состояний, а значения — AnimationGroup из GLB.
   */
  public registerAnimations(
    animations: Partial<Record<PlayerAnimation, AnimationGroup>>,
  ): void {
    for (const [name, group] of Object.entries(animations)) {
      if (group) {
        this.animationGroups.set(name as PlayerAnimation, group);
      }
    }

    this.setAnimation(this.currentAnimation, true);
  }

  public dispose(): void {
    for (const group of this.animationGroups.values()) {
      group.stop();
    }

    this.visual.dispose();
    this.collider.dispose();
  }

  private setAnimation(next: PlayerAnimation, force = false): void {
    if (!force && next === this.currentAnimation) {
      return;
    }

    const previous = this.animationGroups.get(this.currentAnimation);
    previous?.stop();

    this.currentAnimation = next;

    const group = this.animationGroups.get(next);
    if (group) {
      group.start(next !== "interact", 1);
    }
  }
  public get isMoving(): boolean {
    return (
            this.interactionTimeLeft <= 0 &&
            (this.input.moveX !== 0 || this.input.moveZ !== 0)
    );
   }
}