export class MeshRenderBuffer {
  constructor() {
    this.vertexIdToBufferIndex = new Map();
    this.bufferIndexToVertexId = new Map();

    this.faceIdToBufferIndices = new Map();
    this.faceTriangleOffset = new Map();
    this.faceTriangleCount = new Map();

    this.slotAllocator = null;
    this.indexSlotAllocator = null;
  }
}