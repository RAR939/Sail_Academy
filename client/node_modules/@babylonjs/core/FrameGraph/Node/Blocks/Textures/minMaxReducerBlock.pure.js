/** This file must only contain pure code and pure imports */
import { __esDecorate, __runInitializers } from "../../../../tslib.es6.js";

import { FrameGraphMinMaxReducerTask } from "../../../Tasks/Misc/minMaxReducerTask.js";
import { editableInPropertyPage } from "../../../../Decorators/nodeDecorator.js";
import { RegisterClass } from "../../../../Misc/typeStore.js";
import { NodeRenderGraphBlock } from "../../nodeRenderGraphBlock.js";
import { NodeRenderGraphBlockConnectionPointTypes } from "../../Types/nodeRenderGraphTypes.js";
/**
 * Block that reduces a color texture's red channel to its minimum and maximum values.
 * When using a geometry depth-as-color output, enable depthRedux and select the matching depthTextureType.
 * WebGPU depth/stencil attachments are reduced as screen depth automatically.
 * Connect the output to a downstream texture input or a dependency so the block is included in the graph.
 */
let NodeRenderGraphMinMaxReducerBlock = (() => {
    var _a;
    let _classSuper = NodeRenderGraphBlock;
    let _instanceExtraInitializers = [];
    let _get_depthRedux_decorators;
    let _get_depthTextureType_decorators;
    let _get_textureType_decorators;
    let _get_waitForReadback_decorators;
    return _a = class NodeRenderGraphMinMaxReducerBlock extends _classSuper {
            /**
             * Gets the frame graph task associated with this block.
             */
            get task() {
                return this._frameGraphTask;
            }
            /**
             * Creates a min/max reducer block.
             * @param name The block name.
             * @param frameGraph The hosting frame graph.
             * @param scene The hosting scene.
             */
            constructor(name, frameGraph, scene) {
                super(name, frameGraph, scene);
                this._frameGraphTask = __runInitializers(this, _instanceExtraInitializers);
                this.registerInput("source", NodeRenderGraphBlockConnectionPointTypes.AutoDetect);
                this._addDependenciesInput();
                this.registerOutput("output", NodeRenderGraphBlockConnectionPointTypes.Texture);
                this.source.addExcludedConnectionPointFromAllowedTypes(NodeRenderGraphBlockConnectionPointTypes.TextureAllButBackBuffer & ~NodeRenderGraphBlockConnectionPointTypes.TextureMeshBlendTag);
                this._frameGraphTask = new FrameGraphMinMaxReducerTask(name, frameGraph);
            }
            /** Whether to ignore the depth clear value of a depth-as-color source. Depth/stencil attachments are handled automatically. */
            get depthRedux() {
                return this._frameGraphTask.depthRedux;
            }
            set depthRedux(value) {
                this._frameGraphTask.depthRedux = value;
            }
            /** The kind of depth values stored in a depth-as-color source when depth reduction is enabled. */
            get depthTextureType() {
                return this._frameGraphTask.depthTextureType;
            }
            set depthTextureType(value) {
                this._frameGraphTask.depthTextureType = value;
            }
            /** The texture type used for the reduction steps and the 1x1 result. */
            get textureType() {
                return this._frameGraphTask.textureType;
            }
            set textureType(value) {
                this._frameGraphTask.textureType = value;
            }
            /** Wait for WebGPU readback before notifying observers, without blocking the render loop. */
            get waitForReadback() {
                return this._frameGraphTask.waitForReadback;
            }
            set waitForReadback(value) {
                this._frameGraphTask.waitForReadback = value;
            }
            /**
             * Gets the source texture input.
             */
            get source() {
                return this._inputs[0];
            }
            /**
             * Gets the 1x1 RG texture containing the minimum in red and maximum in green.
             */
            get output() {
                return this._outputs[0];
            }
            getClassName() {
                return "NodeRenderGraphMinMaxReducerBlock";
            }
            _buildBlock(state) {
                super._buildBlock(state);
                this.output.value = this._frameGraphTask.outputTexture;
                this._frameGraphTask.sourceTexture = this.source.connectedPoint?.value;
            }
            _dumpPropertiesCode() {
                const codes = [];
                codes.push(`${this._codeVariableName}.depthRedux = ${this.depthRedux};`);
                codes.push(`${this._codeVariableName}.depthTextureType = ${this.depthTextureType};`);
                codes.push(`${this._codeVariableName}.textureType = ${this.textureType};`);
                codes.push(`${this._codeVariableName}.waitForReadback = ${this.waitForReadback};`);
                return super._dumpPropertiesCode() + codes.join("\n");
            }
            serialize() {
                const serializationObject = super.serialize();
                serializationObject.depthRedux = this.depthRedux;
                serializationObject.depthTextureType = this.depthTextureType;
                serializationObject.textureType = this.textureType;
                serializationObject.waitForReadback = this.waitForReadback;
                return serializationObject;
            }
            _deserialize(serializationObject) {
                super._deserialize(serializationObject);
                this.depthRedux = serializationObject.depthRedux ?? false;
                this.depthTextureType = serializationObject.depthTextureType ?? 0 /* DepthTextureType.NormalizedViewDepth */;
                this.textureType = serializationObject.textureType ?? 2;
                this.waitForReadback = serializationObject.waitForReadback ?? false;
            }
        },
        (() => {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _get_depthRedux_decorators = [editableInPropertyPage("Depth-as-color reduction", 0 /* PropertyTypeForEdition.Boolean */, "PROPERTIES")];
            _get_depthTextureType_decorators = [editableInPropertyPage("Depth-as-color type", 5 /* PropertyTypeForEdition.List */, "PROPERTIES", {
                    options: [
                        { label: "Normalized view depth", value: 0 /* DepthTextureType.NormalizedViewDepth */ },
                        { label: "View depth", value: 1 /* DepthTextureType.ViewDepth */ },
                        { label: "Screen depth", value: 2 /* DepthTextureType.ScreenDepth */ },
                    ],
                })];
            _get_textureType_decorators = [editableInPropertyPage("Texture type", 5 /* PropertyTypeForEdition.List */, "PROPERTIES", {
                    options: [
                        { label: "Half float", value: 2 },
                        { label: "Float", value: 1 },
                        { label: "Unsigned byte", value: 0 },
                    ],
                })];
            _get_waitForReadback_decorators = [editableInPropertyPage("Wait for readback", 0 /* PropertyTypeForEdition.Boolean */, "PROPERTIES")];
            __esDecorate(_a, null, _get_depthRedux_decorators, { kind: "getter", name: "depthRedux", static: false, private: false, access: { has: obj => "depthRedux" in obj, get: obj => obj.depthRedux }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(_a, null, _get_depthTextureType_decorators, { kind: "getter", name: "depthTextureType", static: false, private: false, access: { has: obj => "depthTextureType" in obj, get: obj => obj.depthTextureType }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(_a, null, _get_textureType_decorators, { kind: "getter", name: "textureType", static: false, private: false, access: { has: obj => "textureType" in obj, get: obj => obj.textureType }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(_a, null, _get_waitForReadback_decorators, { kind: "getter", name: "waitForReadback", static: false, private: false, access: { has: obj => "waitForReadback" in obj, get: obj => obj.waitForReadback }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(_a, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        })(),
        _a;
})();
export { NodeRenderGraphMinMaxReducerBlock };
let _Registered = false;
/**
 * Registers the min/max reducer block for node render graph deserialization.
 */
export function RegisterMinMaxReducerBlock() {
    if (_Registered) {
        return;
    }
    _Registered = true;
    RegisterClass("BABYLON.NodeRenderGraphMinMaxReducerBlock", NodeRenderGraphMinMaxReducerBlock);
}
//# sourceMappingURL=minMaxReducerBlock.pure.js.map