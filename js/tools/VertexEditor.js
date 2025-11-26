import * as THREE from 'three';
import { LineSegmentsGeometry } from 'jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'jsm/lines/LineSegments2.js';
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { MeshData } from "../core/MeshData.js";

export class VertexEditor {
  constructor(editor, object3D) {
    this.editor = editor;
    this.object = object3D;
    this.sceneManager = this.editor.sceneManager;
  }

  get geometry() {
    return this.object.geometry;
  }

  set geometry(value) {
    this.object.geometry = value;
  }

  get positionAttr() {
    return this.object.geometry.attributes.position;
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
    const vertex = meshData.getVertex(logicalVertexId);
    if (vertex) {
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
      const thinLine = edgeLines.find(line => line.userData.edge === edge);
      if (!thinLine) continue;

      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);
      if (!v1 || !v2) continue;

      const positions = [
        v1.position.x, v1.position.y, v1.position.z,
        v2.position.x, v2.position.y, v2.position.z
      ];

      // Update Invisible Raycast Line
      const posAttr = thinLine.geometry.getAttribute('position');
      posAttr.setXYZ(0, positions[0], positions[1], positions[2]);
      posAttr.setXYZ(1, positions[3], positions[4], positions[5]);
      posAttr.needsUpdate = true;
      thinLine.geometry.computeBoundingSphere();

      // Update Visible Fat Line
      const fatLine = thinLine.userData.visualLine;
      if (fatLine && fatLine.geometry) {
        fatLine.geometry.setPositions(positions);
      }
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
    vertexPoints.matrix.decompose(vertexPoints.position, vertexPoints.quaternion, vertexPoints.scale);
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
      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);

      const positions = [
        v1.position.x, v1.position.y, v1.position.z,
        v2.position.x, v2.position.y, v2.position.z
      ];

      // Visible Line
      const fatGeo = new LineSegmentsGeometry().setPositions(positions);
      const fatMat = new LineMaterial({
        color: 0x000000,
        linewidth: 1,
        dashed: false,
        depthTest: true,
      });
      fatMat.resolution.set(window.innerWidth, window.innerHeight);

      const fatLine = new LineSegments2(fatGeo, fatMat);
      fatLine.computeLineDistances();
      fatLine.renderOrder = 10;
      fatLine.userData.isEditorOnly = true;
      fatLine.userData.edge = edge;
      fatLine.name = '__EdgeLinesVisual';
      this.sceneManager.sceneHelpers.add(fatLine);

      // Invisible Raycast Line
      const thinGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const thinMat = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthTest: false
      });

      const thinLine = new THREE.Line(thinGeo, thinMat);
      thinLine.userData.edge = edge;
      thinLine.userData.isEditorOnly = true;
      thinLine.name = '__EdgeLines';
      thinLine.userData.visualLine = fatLine;
      this.sceneManager.sceneHelpers.add(thinLine);

      [fatLine, thinLine].forEach(line => {
        line.matrix.copy(selectedObject.matrixWorld);
        line.matrix.decompose(line.position, line.quaternion, line.scale);
      })
    }
  }

  removeEdgeLines() {
    const toRemove = [];
    this.sceneManager.sceneHelpers.traverse((obj) => {
      if (obj.userData.isEditorOnly && (obj.name === '__EdgeLines' || obj.name === '__EdgeLinesVisual')) {
        toRemove.push(obj);
      }
    });

    for (let obj of toRemove) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  refreshHelpers() {
    if (!this.object) return;
    this.removeVertexPoints();
    this.removeEdgeLines();

    const mode = this.editor.editSelection.subSelectionMode;

    if (mode === 'vertex') {
      this.addVertexPoints(this.object);
      this.addEdgeLines(this.object);
    } else if (mode === 'edge') {
      this.addEdgeLines(this.object);
    }
  }

  getEdgeLineObjects() {
    const sceneHelpers = this.sceneManager.sceneHelpers;

    const edgeLines = [];
    sceneHelpers.traverse((obj) => {
      // Only return the thin ones for raycasting logic
      if (obj.userData.isEditorOnly && obj.name === '__EdgeLines') {
        edgeLines.push(obj);
      }
    });
    return edgeLines;
  }

  updateGeometryAndHelpers(useEarcut = true) {
    if (!this.object || !this.object.userData.meshData) return;

    const meshData = this.object.userData.meshData;

    const shading = this.object.userData.shading;
    this.geometry = ShadingUtils.createGeometryWithShading(meshData, shading, useEarcut);
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.refreshHelpers();
  }

  applyMeshData(newMeshData) {
    if (!this.object) return false;

    const cloned = structuredClone(newMeshData);
    this.object.userData.meshData = cloned;

    MeshData.rehydrateMeshData(this.object);
  }

  duplicateSelection(vertexIds) {
    const meshData = this.object.userData.meshData;

    const selectedVertices = new Set(vertexIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices
    for (let vid of selectedVertices) {
      const oldVertex = meshData.getVertex(vid);
      if (!oldVertex) continue;

      const newPos = {
        x: oldVertex.position.x,
        y: oldVertex.position.y,
        z: oldVertex.position.z
      };

      const newVertex = meshData.addVertex(newPos);
      duplicatedVertices.set(oldVertex.id, newVertex);
    }

    // Find faces inside selection
    const facesToDuplicate = [];
    for (let face of meshData.faces.values()) {
      const faceVertices = new Set(face.vertexIds);
      const isInside = Array.from(faceVertices).every(vId => selectedVertices.has(vId));
      if (isInside) facesToDuplicate.push(face);
    }

    // Duplicate faces
    for (let oldFace of facesToDuplicate) {
      const newVertices = oldFace.vertexIds.map(vId => duplicatedVertices.get(vId));
      const newFace = meshData.addFace(newVertices);
      duplicatedFaces.set(oldFace.id, newFace);
    }

    // Handle Leftover edges
    for (let edge of meshData.edges.values()) {
      const v1Selected = selectedVertices.has(edge.v1Id);
      const v2Selected = selectedVertices.has(edge.v2Id);

      if (v1Selected && v2Selected) {
        const allFacesDuplicated = Array.from(edge.faceIds).every(fid =>
          duplicatedFaces.has(fid)
        );

        if (!allFacesDuplicated) {
          const v1 = duplicatedVertices.get(edge.v1Id);
          const v2 = duplicatedVertices.get(edge.v2Id);

          if (v1 && v2) {
            const newEdge = meshData.addEdge(v1, v2);
            duplicatedEdges.set(edge.id, newEdge);
          }
        }
      }
    }

    const mappedVertexIds = {};
    for (let [oldId, newVertex] of duplicatedVertices.entries()) {
      mappedVertexIds[oldId] = newVertex.id;
    }

    return {
      mappedVertexIds,
      newVertexIds: Array.from(duplicatedVertices.values().map(v => v.id))
    };
  }

  deleteSelection(vertexIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(vertexIds);

    const deletedFaces = new Set();
    const deletedEdges = new Set();
    const deletedVertices = new Set();

    // Delete faces fully contained in the selection
    for (const face of [...meshData.faces.values()]) {
      const allInside = face.vertexIds.every(vId => selected.has(vId));
      if (allInside) {
        meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    // Delete edges fully contained in the selection
    for (const edge of [...meshData.edges.values()]) {
      const v1Inside = selected.has(edge.v1Id);
      const v2Inside = selected.has(edge.v2Id);

      if (v1Inside && v2Inside && edge.faceIds.size === 0) {
        meshData.deleteEdge(edge);
        deletedEdges.add(edge.id);
      }
    }

    // Delete isolated vertices (no remaining edge or face)
    for (const vId of selected) {
      const v = meshData.getVertex(vId);
      if (!v) continue;

      const stillConnected =
        (v.edgeIds && v.edgeIds.size > 0) ||
        Array.from(meshData.faces.values()).some(f => f.vertexIds.includes(vId));

      if (!stillConnected) {
        meshData.deleteVertex(v);
        deletedVertices.add(v.id);
      }
    }

    return {
      deletedFaces: Array.from(deletedFaces),
      deletedEdges: Array.from(deletedEdges),
      deletedVertices: Array.from(deletedVertices)
    };
  }

  createFaceFromVertices(vertexIds) {
    const meshData = this.object.userData.meshData;
    if (!meshData || !vertexIds || vertexIds.length < 3) {
      return null;
    }

    const vertices = vertexIds.map(id => meshData.getVertex(id)).filter(v => v !== undefined);
    if (vertices.length < 3) return null;

    const newFace = meshData.addFace(vertices);

    return newFace ? newFace.id : null;
  }

  getBoundaryEdges(meshData, vertexIds, edgeIds, faceIds) {
    const selectedVertexSet = new Set(vertexIds);
    const selectedFaceSet = new Set(faceIds);

    // Map edgeKey -> count (how many selected faces reference this edge)
    const edgeCount = new Map();

    for (const faceId of selectedFaceSet) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      const vIds = face.vertexIds;

      for (let i = 0; i < vIds.length; i++) {
        const v1 = vIds[i];
        const v2 = vIds[(i + 1) % vIds.length];

        if (selectedVertexSet.has(v1) && selectedVertexSet.has(v2)) {
          const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        }
      }
    }

    // Boundary edges from faces
    const boundaryEdges = [];
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        const [a, b] = key.split("_").map(Number);
        const edge = meshData.getEdge(a, b);
        if (edge) boundaryEdges.push(edge);
      }
    }

    // Add remaining selected edges not part of any selected face
    if (edgeIds && edgeIds.length > 0) {
      for (const eId of edgeIds) {
        const edge = meshData.edges.get(eId);
        if (!edge) continue;

        const key = edge.v1Id < edge.v2Id ? `${edge.v1Id}_${edge.v2Id}` : `${edge.v2Id}_${edge.v1Id}`;
        if (!edgeCount.has(key)) {
          boundaryEdges.push(edge);
        }
      }
    }

    return boundaryEdges; // Array of Edge objects
  }
}