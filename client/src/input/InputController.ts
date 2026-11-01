import { Vector3 } from "@babylonjs/core";
import type { CameraRig } from "../gameplay/CameraRig";
import type { PlayerInput } from "../gameplay/Player";

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
]);

export class InputController {
  private readonly pressed = new Set<string>();
  private enabled = true;
  private interactionQueued = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !GAME_KEYS.has(event.code)) {
      return;
    }

    event.preventDefault();
    if (event.code === "KeyE" && !this.pressed.has(event.code)) this.interactionQueued = true;
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!GAME_KEYS.has(event.code)) {
      return;
    }

    if (this.enabled) event.preventDefault();
    this.pressed.delete(event.code);
  };

  private readonly clearInput = (): void => {
    this.pressed.clear();
    this.interactionQueued = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clearInput();
  };

  private readonly onPointerLockChange = (): void => {
    // A keyup can be lost when Esc releases pointer lock.
    if (!document.pointerLockElement) this.clearInput();
  };

  public constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    // Capture keyup even if a focused overlay stops propagation.
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.clearInput);
    window.addEventListener("pagehide", this.clearInput);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  public getPlayerInput(cameraRig: CameraRig): PlayerInput {
    if (!this.enabled) {
      return {
        moveX: 0,
        moveZ: 0,
        run: false,
        interactPressed: false,
      };
    }

    const forwardAxis =
      this.axis("KeyW", "ArrowUp") - this.axis("KeyS", "ArrowDown");

    const rightAxis =
      this.axis("KeyD", "ArrowRight") - this.axis("KeyA", "ArrowLeft");

    cameraRig.setMovementAxes(forwardAxis, rightAxis);
    const { forward, right } = cameraRig.getMovementBasis();

    const movement = forward
      .scale(forwardAxis)
      .add(right.scale(rightAxis));

    if (movement.lengthSquared() > 1) {
      movement.normalize();
    }

    const interactPressed = this.interactionQueued || this.isPressed("KeyE");
    this.interactionQueued = false;
    return {
      moveX: movement.x,
      moveZ: movement.z,
      run: this.isPressed("ShiftLeft") || this.isPressed("ShiftRight"),
      interactPressed,
    };
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.clearInput();
    }
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.clearInput);
    window.removeEventListener("pagehide", this.clearInput);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.clearInput();
  }

  private axis(primary: string, alternate: string): number {
    return this.isPressed(primary) || this.isPressed(alternate) ? 1 : 0;
  }

  private isPressed(code: string): boolean {
    return this.pressed.has(code);
  }
}
