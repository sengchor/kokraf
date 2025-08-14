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
    const vertexIndexMap = this.object.userData.vertexIndexMap;

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
    if (meshData && meshData.vertices.has(logicalVertexId)) {
      const vertex = meshData.vertices.get(logicalVertexId);
      vertex.position = { x: localPosition.x, y: localPosition.y, z: localPosition.z };
    }

    // Update helper __VertexPoints
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      const posAttr = vertexPoints.geometry.getAttribute('position');
      posAttr.setXYZ(logicalVertexId, localPosition.x, localPosition.y, localPosition.z);
      posAttr.needsUpdate = true;
    }
  }

  getVertexPosition(logicalVertexId) {
    if (!this.object || !this.positionAttr) return null;

    const vertexIndexMap = this.object.userData.vertexIndexMap;
    const indices = vertexIndexMap.get(logicalVertexId);
    if (!indices || indices.length === 0) return null;

    const bufferIndex = indices[0];
    const localPos = new THREE.Vector3();
    localPos.fromBufferAttribute(this.positionAttr, bufferIndex);

    const worldPos = localPos.clone().applyMatrix4(this.object.matrixWorld);
    return worldPos;
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
    vertexPoints.position.copy(selectedObject.getWorldPosition(new THREE.Vector3()));
  }

  removeVertexPoints(selectedObject) {
    const vertexPoints = selectedObject.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      selectedObject.remove(vertexPoints);
      vertexPoints.geometry.dispose();
      vertexPoints.material.dispose();
    }
  }
  
  addEdgeLines(selectedObject) {
    if (!selectedObject.isMesh || !selectedObject.userData.meshData) return;

    const meshData = selectedObject.userData.meshData;

    for (let edge of meshData.edges.values()) {
      const positions = [
        edge.v1.position.x, edge.v1.position.y, edge.v1.position.z,
        edge.v2.position.x, edge.v2.position.y, edge.v2.position.z
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
      line.name = '__EdgeLines';

      this.sceneManager.sceneHelpers.add(line);
      line.position.copy(selectedObject.getWorldPosition(new THREE.Vector3()));
    }
  }
}