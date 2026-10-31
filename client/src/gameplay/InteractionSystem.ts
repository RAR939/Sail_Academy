import {
  Color3,
  HighlightLayer,
  Mesh,
  Scene,
} from "@babylonjs/core";
import type {
  Interactable,
  InteractionContext,
} from "../world/interactables/Interactable";
import type { Player } from "./Player";

export class InteractionSystem {
  public current: Interactable | null = null;

  private readonly interactables = new Map<string, Interactable>();
  private readonly highlightLayer: HighlightLayer;
  private readonly highlightedMeshes: Mesh[] = [];
  private readonly targetChangedListeners = new Set<
    (target: Interactable | null) => void
  >();

  public constructor(scene: Scene) {
    this.highlightLayer = new HighlightLayer("interaction-highlight", scene);
    this.highlightLayer.outerGlow = false;
    this.highlightLayer.innerGlow = true;
  }

  public register(target: Interactable): () => void {
    if (this.interactables.has(target.id)) {
      throw new Error(`Interactable already registered: ${target.id}`);
    }

    this.interactables.set(target.id, target);

    return () => this.unregister(target.id);
  }

  public unregister(id: string): void {
    const target = this.interactables.get(id);
    if (!target) {
      return;
    }

    if (this.current?.id === id) {
      this.setCurrent(null);
    }

    this.interactables.delete(id);
  }

  public update(player: Player): void {
    const context: InteractionContext = {
      player,
      timestampMs: performance.now(),
    };

    this.setCurrent(this.findNearestTarget(context));

    if (!player.consumeInteractionRequest() || !this.current) {
      return;
    }

    player.playInteraction();

    void Promise.resolve(this.current.interact(context)).catch((error) => {
      console.error(
        `Interaction failed for ${this.current?.id ?? "unknown target"}`,
        error,
      );
    });
  }

  public onTargetChanged(
    listener: (target: Interactable | null) => void,
  ): () => void {
    this.targetChangedListeners.add(listener);

    return () => this.targetChangedListeners.delete(listener);
  }

  public dispose(): void {
    this.clearHighlight();
    this.highlightLayer.dispose();
    this.interactables.clear();
    this.targetChangedListeners.clear();
    this.current = null;
  }

  private findNearestTarget(context: InteractionContext): Interactable | null {
    const playerPosition = context.player.collider.getAbsolutePosition();

    let nearest: Interactable | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const target of this.interactables.values()) {
      if (target.isAvailable && !target.isAvailable(context)) {
        continue;
      }

      const targetPosition = target.anchor.getAbsolutePosition();

      // Высоту игнорируем: игрок может взаимодействовать с объектом на полу.
      const dx = targetPosition.x - playerPosition.x;
      const dz = targetPosition.z - playerPosition.z;
      const distanceSquared = dx * dx + dz * dz;

      if (distanceSquared > target.interactionRadius ** 2) {
        continue;
      }

      if (distanceSquared < nearestDistanceSquared) {
        nearest = target;
        nearestDistanceSquared = distanceSquared;
      }
    }

    return nearest;
  }

  private setCurrent(next: Interactable | null): void {
    if (this.current?.id === next?.id) {
      return;
    }

    this.clearHighlight();
    this.current = next;

    if (next) {
      for (const mesh of this.getMeshesToHighlight(next)) {
        this.highlightLayer.addMesh(mesh, new Color3(0.15, 0.82, 1));
        this.highlightedMeshes.push(mesh);
      }
    }

    for (const listener of this.targetChangedListeners) {
      listener(this.current);
    }
  }

  private clearHighlight(): void {
    for (const mesh of this.highlightedMeshes) {
      this.highlightLayer.removeMesh(mesh);
    }

    this.highlightedMeshes.length = 0;
  }

  private getMeshesToHighlight(target: Interactable): Mesh[] {
  if (target.getHighlightMeshes) {
    return target.getHighlightMeshes();
  }

  const childMeshes = target.anchor
    .getChildMeshes()
    .filter((mesh): mesh is Mesh => mesh instanceof Mesh);

  if (target.anchor instanceof Mesh) {
    return [target.anchor, ...childMeshes];
  }

  return childMeshes;
}
}