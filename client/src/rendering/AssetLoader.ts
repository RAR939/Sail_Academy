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
    const template = await this.load(url);

    const entries = template.instantiateModelsToScene(
      (sourceName) => `${options.name}-${sourceName}`,
      false,
    );

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

    return {
      roots,
      animations: entries.animationGroups,
      dispose: () => entries.dispose(),
    };
  }

  public async preload(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.load(url)));
  }

  public dispose(): void {
    for (const containerPromise of this.templates.values()) {
      void containerPromise.then((container) => container.dispose());
    }

    this.templates.clear();
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