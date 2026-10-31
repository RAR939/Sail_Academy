/** This file must only contain pure code and pure imports */
import { type FrameGraph, type NodeRenderGraphBuildState, type NodeRenderGraphConnectionPoint, type Scene } from "../../../../index.js";
import { DepthTextureType } from "../../../../Misc/thinMinMaxReducer.js";
import { FrameGraphMinMaxReducerTask } from "../../../Tasks/Misc/minMaxReducerTask.js";
import { NodeRenderGraphBlock } from "../../nodeRenderGraphBlock.js";
/**
 * Block that reduces a color texture's red channel to its minimum and maximum values.
 * When using a geometry depth-as-color output, enable depthRedux and select the matching depthTextureType.
 * WebGPU depth/stencil attachments are reduced as screen depth automatically.
 * Connect the output to a downstream texture input or a dependency so the block is included in the graph.
 */
export declare class NodeRenderGraphMinMaxReducerBlock extends NodeRenderGraphBlock {
    protected _frameGraphTask: FrameGraphMinMaxReducerTask;
    /**
     * Gets the frame graph task associated with this block.
     */
    get task(): FrameGraphMinMaxReducerTask;
    /**
     * Creates a min/max reducer block.
     * @param name The block name.
     * @param frameGraph The hosting frame graph.
     * @param scene The hosting scene.
     */
    constructor(name: string, frameGraph: FrameGraph, scene: Scene);
    /** Whether to ignore the depth clear value of a depth-as-color source. Depth/stencil attachments are handled automatically. */
    get depthRedux(): boolean;
    set depthRedux(value: boolean);
    /** The kind of depth values stored in a depth-as-color source when depth reduction is enabled. */
    get depthTextureType(): DepthTextureType;
    set depthTextureType(value: DepthTextureType);
    /** The texture type used for the reduction steps and the 1x1 result. */
    get textureType(): number;
    set textureType(value: number);
    /** Wait for WebGPU readback before notifying observers, without blocking the render loop. */
    get waitForReadback(): boolean;
    set waitForReadback(value: boolean);
    /**
     * Gets the source texture input.
     */
    get source(): NodeRenderGraphConnectionPoint;
    /**
     * Gets the 1x1 RG texture containing the minimum in red and maximum in green.
     */
    get output(): NodeRenderGraphConnectionPoint;
    getClassName(): string;
    protected _buildBlock(state: NodeRenderGraphBuildState): void;
    protected _dumpPropertiesCode(): string;
    serialize(): any;
    _deserialize(serializationObject: any): void;
}
/**
 * Registers the min/max reducer block for node render graph deserialization.
 */
export declare function RegisterMinMaxReducerBlock(): void;
