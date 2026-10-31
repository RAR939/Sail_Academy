
import { ThinMinMaxReducer } from "../../../Misc/thinMinMaxReducer.js";
import { IsDepthTexture, IsIntegerTextureFormat } from "../../../Materials/Textures/textureHelper.functions.js";
import { FrameGraphTask } from "../../frameGraphTask.js";
import { FrameGraphPostProcessTask } from "../PostProcesses/postProcessTask.js";
/**
 * Task which computes the minimum and maximum values in the red channel of a frame graph texture,
 * or in the depth aspect of a WebGPU depth/stencil attachment.
 * Set sourceTexture to a handle from an earlier task (for example, a geometry renderer's geometryNormViewDepthTexture)
 * to reuse its output without rendering another depth map. The reduction is performed on each graph execution.
 */
export class FrameGraphMinMaxReducerTask extends FrameGraphTask {
    /**
     * Wait for WebGPU texture readback before notifying observers (default: false).
     * This delays the notification; it does not block graph execution.
     */
    get waitForReadback() {
        return this._reducer.waitForReadback;
    }
    set waitForReadback(value) {
        this._reducer.waitForReadback = value;
    }
    /**
     * Observable triggered after the reduced texture has been read back.
     * With depthRedux enabled, an empty or equal-valued depth range falls back to [0, 1].
     */
    get onAfterReductionPerformed() {
        return this._reducer.onAfterReductionPerformed;
    }
    /**
     * Creates a min/max reduction task.
     * @param name The name of the task.
     * @param frameGraph The frame graph to add the task to.
     */
    constructor(name, frameGraph) {
        super(name, frameGraph);
        /**
         * Whether to ignore the clear value of a depth-as-color texture during reduction (default: false).
         * For normalized view or forward screen depth, the clear value is 1; for view depth or reverse screen depth, it is 0.
         * Always enabled for a depth/stencil attachment, which stores screen depth.
         */
        this.depthRedux = false;
        /**
         * The type of depth values stored in the source texture when depthRedux is true (default: normalized view depth).
         */
        this.depthTextureType = 0 /* DepthTextureType.NormalizedViewDepth */;
        /**
         * The type of the intermediate and output textures (default: half float).
         * Supported types are FLOAT, HALF_FLOAT, and UNSIGNED_BYTE.
         */
        this.textureType = 2;
        this._stepCount = 0;
        this._reducer = new ThinMinMaxReducer(frameGraph.scene, false);
        this.outputTexture = frameGraph.textureManager.createDanglingHandle();
    }
    getClassName() {
        return "FrameGraphMinMaxReducerTask";
    }
    isReady() {
        for (let i = 0; i < this._stepCount; i++) {
            if (!this._reducer.reductionSteps[i].isReady()) {
                return false;
            }
        }
        return true;
    }
    record() {
        if (this.sourceTexture === undefined) {
            throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: sourceTexture is required`);
        }
        const description = this._frameGraph.textureManager.getTextureDescription(this.sourceTexture);
        const { width, height } = description.size;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
            throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: sourceTexture must have positive integer dimensions`);
        }
        if ((description.options.targetTypes?.[0] ?? 3553) !== 3553) {
            throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: sourceTexture must be a 2D texture`);
        }
        const format = description.options.formats?.[0];
        const sourceIsDepthTexture = format !== undefined && IsDepthTexture(format);
        if (sourceIsDepthTexture) {
            if (!this._frameGraph.engine.isWebGPU) {
                throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: depth/stencil sources require WebGPU`);
            }
            if (this._frameGraph.textureManager.isBackbufferDepthStencil(this.sourceTexture)) {
                throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: backbuffer depth cannot be sampled`);
            }
            if (format !== 15 &&
                format !== 16 &&
                format !== 13 &&
                format !== 14 &&
                format !== 18) {
                throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: sourceTexture must have a supported depth aspect`);
            }
            const samples = description.options.samples;
            if (samples !== undefined && samples !== 0 && samples !== 1) {
                throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: depth/stencil sources must be single-sampled`);
            }
        }
        else if (format !== undefined && IsIntegerTextureFormat(format)) {
            throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: sourceTexture must have a non-integer color format`);
        }
        if (this.textureType !== 1 && this.textureType !== 2 && this.textureType !== 0) {
            throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: textureType must be FLOAT, HALF_FLOAT, or UNSIGNED_BYTE`);
        }
        const depthRedux = this.depthRedux || sourceIsDepthTexture;
        this._reducer.depthRedux = depthRedux;
        const sourceDepthTextureType = sourceIsDepthTexture ? 2 /* DepthTextureType.ScreenDepth */ : this.depthTextureType;
        const depthTextureType = depthRedux && sourceDepthTextureType === 2 /* DepthTextureType.ScreenDepth */ && this._frameGraph.engine.useReverseDepthBuffer
            ? 1 /* DepthTextureType.ViewDepth */
            : sourceDepthTextureType;
        this._reducer.setTextureDimensions(width, height, depthTextureType, sourceIsDepthTexture);
        const steps = this._reducer.reductionSteps;
        const stepCount = Math.max(1, steps.length - 1);
        this._stepCount = stepCount;
        let sourceTexture = this.sourceTexture;
        for (let i = 0; i < stepCount; i++) {
            const step = steps[i];
            const nextStep = steps[i + 1];
            const targetTexture = this._frameGraph.textureManager.createRenderTargetTexture(`${this.name} ${step.name}`, {
                size: { width: nextStep?.textureWidth ?? 1, height: nextStep?.textureHeight ?? 1 },
                sizeIsPercentage: false,
                options: {
                    createMipMaps: false,
                    samples: 1,
                    types: [this.textureType],
                    formats: [7],
                    useSRGBBuffers: [false],
                },
            });
            const pass = new FrameGraphPostProcessTask(`${this.name} ${step.name}`, this._frameGraph, step);
            pass.sourceTexture = sourceTexture;
            pass.sourceSamplingMode = 1;
            pass.targetTexture = targetTexture;
            pass.record(true);
            sourceTexture = pass.outputTexture;
        }
        this._frameGraph.textureManager.resolveDanglingHandle(this.outputTexture, sourceTexture);
        const readPass = this._frameGraph.addPass(`${this.name} Read min/max`);
        readPass.setExecuteFunc((context) => {
            if (!this._reducer.onAfterReductionPerformed.hasObservers()) {
                return;
            }
            const texture = context.getTextureFromHandle(this.outputTexture);
            if (!texture) {
                throw new Error(`FrameGraphMinMaxReducerTask ${this.name}: output texture is unavailable`);
            }
            this._reducer.readMinMax(texture, depthRedux);
        });
        const passDisabled = this._frameGraph.addRenderPass(`${this.name}_disabled`, true);
        passDisabled.setRenderTarget(this.outputTexture);
        passDisabled.setExecuteFunc(() => { });
    }
    dispose() {
        this._reducer.dispose();
        super.dispose();
    }
}
//# sourceMappingURL=minMaxReducerTask.js.map