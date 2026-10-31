import { Observable } from "./observable.js";
import { EffectWrapper } from "../Materials/effectRenderer.pure.js";
import { EngineStore } from "../Engines/engineStore.js";

import { Logger } from "./logger.js";
/**
 * @internal
 */
export var DepthTextureType;
(function (DepthTextureType) {
    DepthTextureType[DepthTextureType["NormalizedViewDepth"] = 0] = "NormalizedViewDepth";
    DepthTextureType[DepthTextureType["ViewDepth"] = 1] = "ViewDepth";
    DepthTextureType[DepthTextureType["ScreenDepth"] = 2] = "ScreenDepth";
})(DepthTextureType || (DepthTextureType = {}));
/**
 * @internal
 */
export class ThinMinMaxReducerPostProcess extends EffectWrapper {
    _gatherImports(useWebGPU, list) {
        if (useWebGPU) {
            this._webGPUReady = true;
            list.push(import("../ShadersWGSL/minmaxRedux.fragment.js"));
        }
        else {
            list.push(import("../Shaders/minmaxRedux.fragment.js"));
        }
    }
    constructor(name, engine = null, defines = "", options) {
        super({
            ...options,
            name,
            engine: engine || EngineStore.LastCreatedEngine,
            useShaderStore: true,
            useAsPostProcess: true,
            fragmentShader: ThinMinMaxReducerPostProcess.FragmentUrl,
            uniforms: ThinMinMaxReducerPostProcess.Uniforms,
            defines,
        });
        this.textureWidth = 0;
        this.textureHeight = 0;
        this.useIntegerTextureSize = false;
    }
    bind(noDefaultBindings = false) {
        super.bind(noDefaultBindings);
        const effect = this.drawWrapper.effect;
        if (this.useIntegerTextureSize) {
            effect.setInt2("texSize", this.textureWidth, this.textureHeight);
        }
        else {
            effect.setFloat2("texSize", this.textureWidth, this.textureHeight);
        }
    }
}
ThinMinMaxReducerPostProcess.FragmentUrl = "minmaxRedux";
ThinMinMaxReducerPostProcess.Uniforms = ["texSize"];
const BufferFloat = new Float32Array(4 * 1 * 1);
const BufferUint8 = new Uint8Array(4 * 1 * 1);
const MinMax = { min: 0, max: 0 };
/**
 * @internal
 */
export class ThinMinMaxReducer {
    get depthRedux() {
        return this._depthRedux;
    }
    set depthRedux(value) {
        if (this._depthRedux === value) {
            return;
        }
        this._depthRedux = value;
        this._recreatePostProcesses();
    }
    get textureWidth() {
        return this._textureWidth;
    }
    get textureHeight() {
        return this._textureHeight;
    }
    constructor(scene, depthRedux = true) {
        this.onAfterReductionPerformed = new Observable();
        /**
         * Wait for WebGPU readback before notifying observers (default: false).
         * Notifications are asynchronous in this mode; WebGL readback remains synchronous.
         */
        this.waitForReadback = false;
        this._sourceIsDepthTexture = false;
        this._readbackPending = false;
        this._readbackGeneration = 0;
        this._textureWidth = 0;
        this._textureHeight = 0;
        this._scene = scene;
        this._depthRedux = depthRedux;
        this.reductionSteps = [];
    }
    setTextureDimensions(width, height, depthTextureType = 0 /* DepthTextureType.NormalizedViewDepth */, sourceIsDepthTexture = false) {
        if (width === this._textureWidth && height === this._textureHeight && depthTextureType === this._depthTextureType && sourceIsDepthTexture === this._sourceIsDepthTexture) {
            return false;
        }
        this._textureWidth = width;
        this._textureHeight = height;
        this._depthTextureType = depthTextureType;
        this._sourceIsDepthTexture = sourceIsDepthTexture;
        this._recreatePostProcesses();
        return true;
    }
    readMinMax(texture, fallbackToFullRange = true) {
        const isFloat = texture.type === 1 || texture.type === 2;
        const engine = this._scene.getEngine();
        const isWebGPU = engine.isWebGPU;
        if (this.waitForReadback && isWebGPU) {
            if (this._readbackPending) {
                return;
            }
            const buffer = isFloat ? (this._waitBufferFloat ?? (this._waitBufferFloat = new Float32Array(4))) : (this._waitBufferUint8 ?? (this._waitBufferUint8 = new Uint8Array(4)));
            const result = (this._waitMinMax ?? (this._waitMinMax = { min: 0, max: 0 }));
            const generation = this._readbackGeneration;
            // Submit the reduction before copying: the frame graph may reuse this texture later in the frame.
            const readback = engine._readTexturePixels(texture, 1, 1, -1, 0, buffer, true);
            this._readbackPending = true;
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._completeReadbackAsync(readback, buffer, isFloat, fallbackToFullRange, generation, result);
            return;
        }
        // WebGL updates the buffer synchronously. WebGPU notifies with previous values, but
        // still needs to submit this reduction before another graph task can reuse its texture.
        let buffer;
        if (isWebGPU) {
            buffer = isFloat ? (this._defaultBufferFloat ?? (this._defaultBufferFloat = new Float32Array(4))) : (this._defaultBufferUint8 ?? (this._defaultBufferUint8 = new Uint8Array(4)));
        }
        else {
            buffer = isFloat ? BufferFloat : BufferUint8;
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        engine._readTexturePixels(texture, 1, 1, -1, 0, buffer, isWebGPU);
        this._notifyMinMax(buffer, isFloat, fallbackToFullRange, isWebGPU ? (this._defaultMinMax ?? (this._defaultMinMax = { min: 0, max: 0 })) : MinMax);
    }
    async _completeReadbackAsync(readback, buffer, isFloat, fallbackToFullRange, generation, result) {
        try {
            await readback;
            if (generation === this._readbackGeneration && this.waitForReadback) {
                this._notifyMinMax(buffer, isFloat, fallbackToFullRange, result);
            }
        }
        catch (error) {
            Logger.Error(`ThinMinMaxReducer: Failed to complete min/max readback: ${error}`);
        }
        finally {
            this._readbackPending = false;
        }
    }
    _notifyMinMax(buffer, isFloat, fallbackToFullRange, result) {
        result.min = buffer[0];
        result.max = buffer[1];
        if (!isFloat) {
            result.min /= 255.0;
            result.max /= 255.0;
        }
        if (fallbackToFullRange && result.min >= result.max) {
            result.min = 0;
            result.max = 1;
        }
        this.onAfterReductionPerformed.notifyObservers(result);
    }
    dispose(disposeAll = true) {
        this._readbackGeneration++;
        if (disposeAll) {
            this.onAfterReductionPerformed.clear();
            this._textureWidth = 0;
            this._textureHeight = 0;
        }
        for (let i = 0; i < this.reductionSteps.length; ++i) {
            this.reductionSteps[i].dispose();
        }
        this.reductionSteps.length = 0;
    }
    _recreatePostProcesses() {
        this.dispose(false);
        const scene = this._scene;
        let w = this.textureWidth, h = this.textureHeight;
        const reductionInitial = new ThinMinMaxReducerPostProcess("Initial reduction phase", scene.getEngine(), "#define INITIAL" +
            (w === 1 || h === 1 ? "\n#define CLAMP_REDUCTION_COORDS" : "") +
            (this._sourceIsDepthTexture ? "\n#define DEPTH_TEXTURE" : "") +
            (this._depthRedux ? "\n#define DEPTH_REDUX" : "") +
            (this._depthTextureType === 1 /* DepthTextureType.ViewDepth */ ? "\n#define VIEW_DEPTH" : ""));
        reductionInitial.textureWidth = w;
        reductionInitial.textureHeight = h;
        this.reductionSteps.push(reductionInitial);
        let index = 1;
        // create the additional steps
        while (w > 1 || h > 1 || (w === 1 && h === 1 && index === 1)) {
            w = Math.max(Math.round(w / 2), 1);
            h = Math.max(Math.round(h / 2), 1);
            const reduction = new ThinMinMaxReducerPostProcess("Reduction phase " + index, scene.getEngine(), "#define " + (w == 1 && h == 1 ? "LAST" : w == 1 || h == 1 ? "ONEBEFORELAST" : "MAIN"));
            reduction.textureWidth = w;
            reduction.textureHeight = h;
            reduction.useIntegerTextureSize = w === 1 || h === 1;
            this.reductionSteps.push(reduction);
            index++;
        }
    }
}
//# sourceMappingURL=thinMinMaxReducer.js.map