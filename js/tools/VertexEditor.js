import * as THREE from 'three';
import { LineSegmentsGeometry } from 'jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'jsm/lines/LineSegments2.js';

export class VertexEditor {
  constructor(editor, object3D) {
    this.editor = editor;
    this.object = object3D;
    this.geometry = object3D.geometry;
    this.positionAttr = this.geometry.attributes.position;
    this.sceneManager = this.editor.sceneManager;
  }

  setVertexWorldPosition(logicalVertexId, worldPosition) {
    if (!this.object || !this.positionAttr) return;

    const meshData = this.object.userData.meshData;
    const vertexIndexMap = meshData.vertexIndexMap;

    const localPosition = worldPosition.clone().applyMatrix4(
      new THREE.Matrix4().copy(this.object.matrixWorld).invert()
    );

    // Update buffer geometry positions
    const indices = vertexIndexMap.get(logicalVertexId);
    if (!indices) return;

    for (let bufferIndex of indices) {
      this.positionAttr.setXYZ(bufferIndex, localPosition.x, localPosition.y, localPosition.z);
    }
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    // Update logical meshData vertex
    let vertex;
    if (meshData && meshData.vertices.has(logicalVertexId)) {
      vertex = meshData.vertices.get(logicalVertexId);
      vertex.position = { x: localPosition.x, y: localPosition.y, z: localPosition.z };
    }

    // Update helper __VertexPoints
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      const posAttr = vertexPoints.geometry.getAttribute('position');
      posAttr.setXYZ(logicalVertexId, localPosition.x, localPosition.y, localPosition.z);
      posAttr.needsUpdate = true;
    }
    if (vertexPoints && vertexPoints.geometry) {
      vertexPoints.geometry.computeBoundingBox();
      vertexPoints.geometry.computeBoundingSphere();
    }

    // Update helper __EdgeLines
    const edgeLines = this.getEdgeLineObjects();
    for (let edgeId of vertex.edgeIds) {
      const edge = meshData.edges.get(edgeId);
      const line = edgeLines.find(line => line.userData.edge === edge);
      if (!line || !line.geometry) continue;

      const v1 = meshData.vertices.get(edge.v1Id);
      const v2 = meshData.vertices.get(edge.v2Id);
      if (!v1 || !v2) continue;

      const positions = [
        v1.position.x, v1.position.y, v1.position.z,
        v2.position.x, v2.position.y, v2.position.z
      ];

      line.geometry.setPositions(positions);
    }
  }

  setVerticesWorldPositions(logicalVertexIds, worldPositions) {
    if (!this.object || !this.positionAttr) return;

    for (let i = 0; i < logicalVertexIds.length; i++) {
      this.setVertexWorldPosition(logicalVertexIds[i], worldPositions[i]);
    }
  }

  getVertexPosition(logicalVertexId) {
    if (!this.object || !this.positionAttr) return null;

    const meshData = this.object.userData.meshData;
    const vertexIndexMap = meshData.vertexIndexMap;
    const indices = vertexIndexMap.get(logicalVertexId);
    if (!indices || indices.length === 0) return null;

    const bufferIndex = indices[0];
    const localPos = new THREE.Vector3();
    localPos.fromBufferAttribute(this.positionAttr, bufferIndex);

    const worldPos = localPos.clone().applyMatrix4(this.object.matrixWorld);
    return worldPos;
  }

  getVertexPositions(vertexIds) {
    const positions = [];

    if (!this.object || !this.positionAttr || !vertexIds || vertexIds.length === 0) {
      return positions;
    }

    for (let vId of vertexIds) {
      const pos = this.getVertexPosition(vId);
      if (pos) positions.push(pos.clone());
    }

    return positions;
  }

  addVertexPoints(selectedObject) {
    const meshData = selectedObject.userData.meshData;
    const positions = [];
    const colors = [];
    const ids = [];

    for (let v of meshData.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      colors.push(0, 0, 0);
      ids.push(v.id);
    }
    
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    pointGeometry.setAttribute('vertexId', new THREE.Uint16BufferAttribute(ids, 1));

    const pointMaterial = new THREE.PointsMaterial({
      size: 3.5,
      sizeAttenuation: false,
      vertexColors: true
    });

    const vertexPoints = new THREE.Points(pointGeometry, pointMaterial);
    vertexPoints.renderOrder = 11;
    vertexPoints.userData.isEditorOnly = true;
    vertexPoints.name = '__VertexPoints';
    this.sceneManager.sceneHelpers.add(vertexPoints);
    vertexPoints.matrix.copy(selectedObject.matrixWorld);
    vertexPoints.matrix.decompose(
      vertexPoints.position,
      vertexPoints.quaternion,
      vertexPoints.scale
    );
  }

  removeVertexPoints() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      if (vertexPoints.parent) vertexPoints.parent.remove(vertexPoints);
      if (vertexPoints.geometry) vertexPoints.geometry.dispose();
      if (vertexPoints.material) vertexPoints.material.dispose();
    }
  }
  
  addEdgeLines(selectedObject) {
    if (!selectedObject.isMesh || !selectedObject.userData.meshData) return;

    const meshData = selectedObject.userData.meshData;

    for (let edge of meshData.edges.values()) {
      const v1 = meshData.vertices.get(edge.v1Id);
      const v2 = meshData.vertices.get(edge.v2Id);

      const positions = [
        v1.position.x, v1.position.y, v1.position.z,
        v2.position.x, v2.position.y, v2.position.z
      ];

      const linegeometry = new LineSegmentsGeometry().setPositions(positions);

      const material = new LineMaterial({
        color: 0x000000,
        linewidth: 1,
        dashed: false,
        depthTest: true,
      });
      material.resolution.set(window.innerWidth, window.innerHeight);

      const line = new LineSegments2(linegeometry, material);
      line.computeLineDistances();
      line.renderOrder = 10;

      line.userData.isEditorOnly = true;
      line.userData.edge = edge;
      line.name = '__EdgeLines';

      this.sceneManager.sceneHelpers.add(line);
      line.matrix.copy(selectedObject.matrixWorld);
      line.matrix.decompose(
        line.position,
        line.quaternion,
        line.scale
      );
    }
  }

  removeEdgeLines() {
    const edgeLines = this.getEdgeLineObjects();

    for (let obj of edgeLines) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  getEdgeLineObjects() {
    const sceneHelpers = this.sceneManager.sceneHelpers;

    const edgeLines = [];
    sceneHelpers.traverse((obj) => {
      if (obj.userData.isEditorOnly && obj.name === '__EdgeLines') {
        edgeLines.push(obj);
      }
    });
    return edgeLines;
  }
}