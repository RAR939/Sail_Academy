import { type Nullable, type EffectWrapperCreationOptions, type AbstractEngine, type InternalTexture, type Scene } from "../index.js";
import { Observable } from "./observable.js";
import { EffectWrapper } from "../Materials/effectRenderer.pure.js";
/**
 * @internal
 */
export declare enum DepthTextureType {
    NormalizedViewDepth = 0,
    ViewDepth = 1,
    ScreenDepth = 2
}
/**
 * @internal
 */
export declare class ThinMinMaxReducerPostProcess extends EffectWrapper {
    static readonly FragmentUrl = "minmaxRedux";
    static readonly Uniforms: string[];
    protected _gatherImports(useWebGPU: boolean, list: Promise<any>[]): void;
    textureWidth: number;
    textureHeight: number;
    useIntegerTextureSize: boolean;
    constructor(name: string, engine?: Nullable<AbstractEngine>, defines?: string, options?: EffectWrapperCreationOptions);
    bind(noDefaultBindings?: boolean): void;
}
/**
 * @internal
 */
export declare class ThinMinMaxReducer {
    readonly onAfterReductionPerformed: Observable<{
        min: number;
        max: number;
    }>;
    readonly reductionSteps: Array<ThinMinMaxReducerPostProcess>;
    /**
     * Wait for WebGPU readback before notifying observers (default: false).
     * Notifications are asynchronous in this mode; WebGL readback remains synchronous.
     */
    waitForReadback: boolean;
    private _depthRedux;
    private _depthTextureType;
    private _sourceIsDepthTexture;
    private _waitBufferFloat?;
    private _waitBufferUint8?;
    private _waitMinMax?;
    private _defaultBufferFloat?;
    private _defaultBufferUint8?;
    private _defaultMinMax?;
    private _readbackPending;
    private _readbackGeneration;
    get depthRedux(): boolean;
    set depthRedux(value: boolean);
    protected readonly _scene: Scene;
    private _textureWidth;
    private _textureHeight;
    get textureWidth(): number;
    get textureHeight(): number;
    constructor(scene: Scene, depthRedux?: boolean);
    setTextureDimensions(width: number, height: number, depthTextureType?: DepthTextureType, sourceIsDepthTexture?: boolean): boolean;
    readMinMax(texture: InternalTexture, fallbackToFullRange?: boolean): void;
    private _completeReadbackAsync;
    private _notifyMinMax;
    dispose(disposeAll?: boolean): void;
    private _recreatePostProcesses;
}
