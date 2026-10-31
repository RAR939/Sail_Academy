import type { Mesh, TransformNode } from "@babylonjs/core";
import type { Player } from "../../gameplay/Player";

export type InteractableKind = "npc" | "item" | "boat";

export interface InteractionContext {
  player: Player;
  timestampMs: number;
}

export interface Interactable {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly anchor: TransformNode;
  readonly prompt: string;
  readonly interactionRadius: number;

  isAvailable?(context: InteractionContext): boolean;

  /**
   * Здесь NPC откроет диалог, предмет попадёт в инвентарь,
   * а лодка посадит игрока на борт.
   */
  interact(context: InteractionContext): void | Promise<void>;

  /** Меши, которые будут подсвечены при выборе. */
  getHighlightMeshes?(): Mesh[];
}