import {
  AbstractMesh,
  AnimationGroup,
  AssetContainer,
  LoadAssetContainerAsync,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

export interface SpawnAssetOptions {
  name: string;
  position?: Vector3;
  rotation?: Vector3;
  scaling?: Vector3;
  parent?: TransformNode | null;
  checkCollisions?: boolean;
}

export interface SpawnedAsset {
  roots: TransformNode[];
  animations: AnimationGroup[];
  dispose(): void;
}

export class AssetLoader {
  private readonly templates = new Map<string, Promise<AssetContainer>>();
  private readonly references = new Map<string, number>();
  private closed = false;

  public constructor(private readonly scene: Scene) {}

  /**
   * Загружает GLB в кэш. Модель не добавляется в сцену до вызова spawn().
   */
  public load(url: string): Promise<AssetContainer> {
    const cached = this.templates.get(url);

    if (cached) {
      return cached;
    }

    const loading = LoadAssetContainerAsync(url, this.scene).catch((error) => {
      this.templates.delete(url);
      throw error;
    });

    this.templates.set(url, loading);
    return loading;
  }

  /**
   * Создаёт копию модели из кэша.
   * Материалы и геометрия остаются общими, поэтому повторные пропсы дешёвые.
   */
  public async spawn(
    url: string,
    options: SpawnAssetOptions,
  ): Promise<SpawnedAsset> {
    if (this.closed) throw new Error("Asset loader disposed");
    this.references.set(url, (this.references.get(url) ?? 0) + 1);
    let template: AssetContainer;
    try { template = await this.load(url); }
    catch (error) { this.release(url); throw error; }
    if (this.closed) { this.release(url); throw new Error("Asset loader disposed"); }

    let entries;
    try { entries = template.instantiateModelsToScene(
      (sourceName) => `${options.name}-${sourceName}`,
      false,
    ); } catch (error) { this.release(url); throw error; }

    const roots = entries.rootNodes.filter(
      (node): node is TransformNode => node instanceof TransformNode,
    );

    for (const root of roots) {
      root.parent = options.parent ?? null;

      if (options.position) {
        root.position.copyFrom(options.position);
      }

      if (options.rotation) {
        root.rotation.copyFrom(options.rotation);
      }

      if (options.scaling) {
        root.scaling.copyFrom(options.scaling);
      }

      this.setCollisions(root, options.checkCollisions ?? false);
    }

    let disposed = false;
    return {
      roots,
      animations: entries.animationGroups,
      dispose: () => { if (disposed) return; disposed = true; entries.dispose(); this.release(url); },
    };
  }

  public async preload(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.load(url)));
  }

  public dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const containerPromise of this.templates.values()) {
      void containerPromise.then((container) => container.dispose());
    }

    this.templates.clear();
    this.references.clear();
  }

  private release(url: string): void {
    const count = this.references.get(url);
    if (count === undefined) return;
    if (count > 1) { this.references.set(url, count - 1); return; }
    this.references.delete(url);
    const template = this.templates.get(url);
    this.templates.delete(url);
    if (template) void template.then(container => container.dispose()).catch(() => {});
  }

  private setCollisions(root: TransformNode, enabled: boolean): void {
    if (root instanceof AbstractMesh) {
      root.checkCollisions = enabled;
    }

    for (const mesh of root.getChildMeshes()) {
      mesh.checkCollisions = enabled;
    }
  }
}
