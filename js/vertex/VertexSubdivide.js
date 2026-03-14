import * as THREE from 'three';

export class VertexSubdivide {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() { return this.vertexEditor.meshData; }

  insetSubdivide(faceId, segments) {
    if (segments < 2) return null;

    const face = this.meshData.faces.get(faceId);
    const center = this.getCenterPoint(face.vertexIds);

    const faceVertices = face.vertexIds.map(vId => this.meshData.getVertex(vId));
    const vertexOrderPerLayer = [];
    const layers = Math.floor((segments - 1) / 2);

    for (let layer = 0; layer < layers + 1; layer++) {
      const layerVertices = [];

      const pointNums = segments - 2 * layer;
      for (let vIndex = 0; vIndex < faceVertices.length; vIndex++) {
        const vA = faceVertices[vIndex].position;
        const vB = faceVertices[(vIndex + 1) % faceVertices.length].position;

        const edgeLengthA = new THREE.Vector3().subVectors(vA, center).length();
        const edgeLengthB = new THREE.Vector3().subVectors(vB, center).length();
        const value = (segments % 2 === 0) ? 1 : 0.5;
        const lengthA = (edgeLengthA * layer / (layers + value));
        const lengthB = (edgeLengthB * layer / (layers + value));
        const offsetDirectionA = new THREE.Vector3().copy(vA).sub(center).normalize();
        const offsetDirectionB = new THREE.Vector3().copy(vB).sub(center).normalize();

        // add the original vertex in correct order
        const offsetVA = new THREE.Vector3().copy(vA).sub(offsetDirectionA.multiplyScalar(lengthA));
        const offsetVB = new THREE.Vector3().copy(vB).sub(offsetDirectionB.multiplyScalar(lengthB));
        const vertexA = this.meshData.addVertex(new THREE.Vector3().copy(offsetVA));
        layerVertices.push(vertexA);

        // add subdivided points along the edge
        const edgeVertices = [];
        for (let i = 0; i < pointNums - 1; i++) {
          const t = (i + 1) / pointNums;

          const pos = new THREE.Vector3().lerpVectors(offsetVA, offsetVB, t);
          const vertex = this.meshData.addVertex(pos);
          edgeVertices.push(vertex);
        }
        if (edgeVertices.length > 0) {
          layerVertices.push(edgeVertices);
        }
      }
      
      vertexOrderPerLayer.push(layerVertices);
    }

    const allVertices = vertexOrderPerLayer.flat(2);

    if (segments % 2 === 0) {
      const centerVertex = this.meshData.addVertex(center);
      const edgeVertices = [];
      for (let i = 0; i < faceVertices.length; i++) {
        edgeVertices.push(centerVertex);
      }
      vertexOrderPerLayer.push(edgeVertices);
      allVertices.push(centerVertex);
    }

    this.connectInsetLayers(vertexOrderPerLayer, segments);

    this.vertexEditor.delete.deleteFaces([face.id]);
    const boundaryVertices = vertexOrderPerLayer[0].flat();

    return { allVertices, boundaryVertices };
  }

  insetSubdivideVertices(orderVertexIds, segments) {
    if (segments < 2) return null;

    const faceVertexIds = [];
    const orderVertices = [];
    for (const order of orderVertexIds) {
      if (!Array.isArray(order)) {
        faceVertexIds.push(order);
        orderVertices.push(this.meshData.getVertex(order));
      } else {
        const vertices = order.map(vId => this.meshData.getVertex(vId));
        orderVertices.push(vertices);
      }
    }
    const faceVertices = faceVertexIds.map(vId => this.meshData.getVertex(vId));

    const center = this.getCenterPoint(faceVertexIds);

    const vertexOrderPerLayer = [];
    const layers = Math.floor((segments - 1) / 2);
    vertexOrderPerLayer.push(orderVertices);

    for (let layer = 1; layer < layers + 1; layer++) {
      const layerVertices = [];

      const pointNums = segments - 2 * layer;
      for (let vIndex = 0; vIndex < faceVertices.length; vIndex++) {
        const vA = faceVertices[vIndex].position;
        const vB = faceVertices[(vIndex + 1) % faceVertices.length].position;

        const edgeLengthA = new THREE.Vector3().subVectors(vA, center).length();
        const edgeLengthB = new THREE.Vector3().subVectors(vB, center).length();
        const value = (segments % 2 === 0) ? 1 : 0.5;
        const lengthA = (edgeLengthA * layer / (layers + value));
        const lengthB = (edgeLengthB * layer / (layers + value));
        const offsetDirectionA = new THREE.Vector3().copy(vA).sub(center).normalize();
        const offsetDirectionB = new THREE.Vector3().copy(vB).sub(center).normalize();

        // add the original vertex in correct order
        const offsetVA = new THREE.Vector3().copy(vA).sub(offsetDirectionA.multiplyScalar(lengthA));
        const offsetVB = new THREE.Vector3().copy(vB).sub(offsetDirectionB.multiplyScalar(lengthB));
        const vertexA = this.meshData.addVertex(new THREE.Vector3().copy(offsetVA));
        layerVertices.push(vertexA);

        // add subdivided points along the edge
        const edgeVertices = [];
        for (let i = 0; i < pointNums - 1; i++) {
          const t = (i + 1) / pointNums;

          const pos = new THREE.Vector3().lerpVectors(offsetVA, offsetVB, t);
          const vertex = this.meshData.addVertex(pos);
          edgeVertices.push(vertex);
        }
        if (edgeVertices.length > 0) {
          layerVertices.push(edgeVertices);
        }
      }
      
      vertexOrderPerLayer.push(layerVertices);
    }

    const allVertices = vertexOrderPerLayer.flat(2);

    if (segments % 2 === 0) {
      const centerVertex = this.meshData.addVertex(center);
      const edgeVertices = [];
      for (let i = 0; i < faceVertices.length; i++) {
        edgeVertices.push(centerVertex);
      }
      vertexOrderPerLayer.push(edgeVertices);
      allVertices.push(centerVertex);
    }

    this.connectInsetLayers(vertexOrderPerLayer, segments);

    const boundaryVertices = vertexOrderPerLayer[0].flat();

    return { allVertices, boundaryVertices };
  }

  connectInsetLayers(vertexOrderPerLayer, segments) {
    for (let layer = 0; layer < vertexOrderPerLayer.length - 1; layer ++) {
      const outer = vertexOrderPerLayer[layer];
      const inner = vertexOrderPerLayer[layer + 1];

      const cornerFaceVertices = [];
      const outerEdgeVertices = [];
      for (let i = 0; i < outer.length; i++) {
        if (Array.isArray(outer[i])) {
          outerEdgeVertices.push(outer[i]);
          continue;
        }

        const prevIndex = (i - 1 + outer.length) % outer.length;
        const nextIndex = (i + 1) % outer.length;

        const cornerVertices = [
          outer[prevIndex][outer[prevIndex].length - 1],
          outer[i],
          outer[nextIndex][0]
        ];

        cornerFaceVertices.push(cornerVertices);
      }

      let cornerCount = 0;
      for (let i = 0; i < inner.length; i++) {
        if (Array.isArray(inner[i])) {
          continue;
        }
        
        cornerFaceVertices[cornerCount].push(inner[i]);
        cornerCount++;
      }

      const innerEdgeVertices = [];
      for (let i = 0; i < inner.length; i++) {
        if (!Array.isArray(inner[i])) {
          const nextIndex = (i + 1) % inner.length;

          let group = [inner[i]];

          if (Array.isArray(inner[nextIndex])) {
            group.push(...inner[nextIndex]);

            const nextCornerIndex = (nextIndex + 1) % inner.length;
            group.push(inner[nextCornerIndex]);
          } else {
            group.push(inner[nextIndex]);
          }

          innerEdgeVertices.push(group);
        }
      }

      for (const faceVertices of cornerFaceVertices) {
        const face = this.meshData.addFace(faceVertices);
      }

      const edgeFaceVertices = [];
      for (let i = 0; i < outerEdgeVertices.length; i++) {
        const outerVertices = outerEdgeVertices[i];
        const innerVertices = innerEdgeVertices[i];

        if (!outerVertices || !innerVertices) return;

        const count = Math.min(outerVertices.length, innerVertices.length);

        for (let j = 0; j < count - 1; j++) {
          edgeFaceVertices.push([outerVertices[j], outerVertices[j + 1], innerVertices[j + 1], innerVertices[j]]);
        }
      }

      for (const faceVertices of edgeFaceVertices) {
        const face = this.meshData.addFace(faceVertices);
      }
    }

    if (segments % 2 !== 0) {
      const lastLayer = vertexOrderPerLayer[vertexOrderPerLayer.length - 1];
      const face = this.meshData.addFace(lastLayer);
    }
  }

  smoothVertices(vertices, lambda, ignoreVertices) {
    const newPositions = new Map();
    const ignoreVerticesSet = new Set(ignoreVertices);

    for (const vertex of vertices) {
      if (ignoreVerticesSet.has(vertex)) continue;

      const neighbors = this.getNeighborVertices(vertex);

      if (neighbors.length === 0) continue;

      const avg = new THREE.Vector3();
      for (const n of neighbors) {
        avg.add(new THREE.Vector3().copy(n.position));
      }

      avg.divideScalar(neighbors.length);

      const newPos = vertex.position.clone().lerp(avg, lambda);

      newPositions.set(vertex.id, newPos);
    }

    // apply after computing all
    for (const [vId, pos] of newPositions) {
      const vertex = this.meshData.vertices.get(vId);
      vertex.position.copy(pos);
    }
  }

  getNeighborVertices(vertex) {
    const neighbors = new Set();

    for (const edgeId of vertex.edgeIds) {
      const edge = this.meshData.edges.get(edgeId);

      const otherId =
        edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id;

      neighbors.add(this.meshData.getVertex(otherId));
    }

    return [...neighbors];
  }

  getCenterPoint(vertexIds) {
    const center = new THREE.Vector3();
    vertexIds.forEach(id => center.add(this.meshData.getVertex(id).position));
    return center.divideScalar(vertexIds.length);
  }
}