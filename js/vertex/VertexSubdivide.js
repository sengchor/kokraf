import * as THREE from 'three';

export class VertexSubdivide {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() { return this.vertexEditor.meshData; }

  insetSubdivideVertices(orderVertexIds, segments, targetPosition) {
    if (segments < 1) return null;

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
    const faceNormal = targetPosition.clone().sub(center).normalize();
    const targetDistance = (targetPosition.clone().sub(center)).length();

    const bulgeAmount = targetDistance * 0.5;
    const curvedCenter = new THREE.Vector3().copy(center)
      .add(faceNormal.clone().multiplyScalar(bulgeAmount));

    const vertexOrderPerLayer = [];
    vertexOrderPerLayer.push(orderVertices);

    const layers = Math.floor((segments - 1) / 2);

    for (let layer = 1; layer < layers + 1; layer++) {
      const layerVertices = [];

      const pointNums = segments - 2 * layer;

      for (let vIndex = 0; vIndex < faceVertices.length; vIndex++) {
        const vA = faceVertices[vIndex];
        const vB = faceVertices[(vIndex + 1) % faceVertices.length];

        const vAPos = new THREE.Vector3().copy(vA.position);
        const vBPos = new THREE.Vector3().copy(vB.position);

        const value = (segments % 2 === 0) ? 1 : 0.5;
        const t = layer / (layers + value);

        const controlA = new THREE.Vector3().lerpVectors(vAPos, curvedCenter, 0.5)
          .add(faceNormal.clone().multiplyScalar(bulgeAmount * 0.5));
        const controlB = new THREE.Vector3().lerpVectors(vBPos, curvedCenter, 0.5)
          .add(faceNormal.clone().multiplyScalar(bulgeAmount * 0.5));

        const offsetVA = new THREE.QuadraticBezierCurve3(vAPos, controlA, curvedCenter).getPoint(t);
        const offsetVB = new THREE.QuadraticBezierCurve3(vBPos, controlB, curvedCenter).getPoint(t);

        const vertexA = this.meshData.addVertex(new THREE.Vector3().copy(offsetVA));
        layerVertices.push(vertexA);

        const outerEdgeVerts = vertexOrderPerLayer[layer - 1].filter(v => Array.isArray(v));

        // add subdivided points along the edge
        const edgeVertices = [];

        const outerGroup = outerEdgeVerts[vIndex];
        const outerEdgeStartPos  = new THREE.Vector3().copy(outerGroup[0].position);
        const outerEdgeEndPos = new THREE.Vector3().copy(outerGroup[outerGroup.length - 1].position);

        const displacementA = offsetVA.clone().sub(outerEdgeStartPos);
        const displacementB = offsetVB.clone().sub(outerEdgeEndPos);

        for (let i = 0; i < pointNums - 1; i++) {
          const edgeT = (i + 1) / pointNums;

          const outerVetex = outerGroup[i + 1];
          const outerPt = new THREE.Vector3().copy(outerVetex.position);

          const displacement = new THREE.Vector3().lerpVectors(displacementA, displacementB, edgeT);

          const innerPt = outerPt.clone().add(displacement);

          const vertex = this.meshData.addVertex(innerPt);
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
      const centerVertex = this.meshData.addVertex(curvedCenter);
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

  getCenterPoint(vertexIds) {
    const center = new THREE.Vector3();
    vertexIds.forEach(id => center.add(this.meshData.getVertex(id).position));
    return center.divideScalar(vertexIds.length);
  }
}