import { SlotAllocator } from "./SlotAllocator.js";

export class MeshRenderBuffer {
  constructor() {
    this.vertexIdToBufferIndex = new Map();
    this.bufferIndexToVertexId = new Map();

    this.faceIdToBufferIndices = new Map();
    this.faceTriangleOffset = new Map();
    this.faceTriangleCount = new Map();

    this.normalMode = null;
    this.normalAngle = null;

    this.slotAllocator = null;
    this.indexSlotAllocator = null;
  }

  static rehydrateRenderBuffer(object) {
    const renderBuffer = object.userData.renderBuffer;
    if (!renderBuffer) return null;

    Object.setPrototypeOf(
      renderBuffer,
      MeshRenderBuffer.prototype
    );
    console.log(renderBuffer);

    renderBuffer.vertexIdToBufferIndex =
      renderBuffer.vertexIdToBufferIndex instanceof Map
        ? renderBuffer.vertexIdToBufferIndex
        : new Map(renderBuffer.vertexIdToBufferIndex);

    renderBuffer.bufferIndexToVertexId =
      renderBuffer.bufferIndexToVertexId instanceof Map
        ? renderBuffer.bufferIndexToVertexId
        : new Map(renderBuffer.bufferIndexToVertexId);

    renderBuffer.faceIdToBufferIndices =
      renderBuffer.faceIdToBufferIndices instanceof Map
        ? renderBuffer.faceIdToBufferIndices
        : new Map(renderBuffer.faceIdToBufferIndices);

    renderBuffer.faceTriangleOffset =
      renderBuffer.faceTriangleOffset instanceof Map
        ? renderBuffer.faceTriangleOffset
        : new Map(renderBuffer.faceTriangleOffset);

    renderBuffer.faceTriangleCount =
      renderBuffer.faceTriangleCount instanceof Map
        ? renderBuffer.faceTriangleCount
        : new Map(renderBuffer.faceTriangleCount);

    if (renderBuffer.slotAllocator) {
      Object.setPrototypeOf(
        renderBuffer.slotAllocator,
        SlotAllocator.prototype
      );
    }

    if (renderBuffer.indexSlotAllocator) {
      Object.setPrototypeOf(
        renderBuffer.indexSlotAllocator,
        SlotAllocator.prototype
      );
    }

    return renderBuffer;
  }
}