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
    const indices = [];

    for (let v of meshData.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      colors.push(0, 0, 0);
      indices.push(v.id);
    }
    
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    pointGeometry.setAttribute('vertexId', new THREE.Uint16BufferAttribute(indices, 1));

    const pointMaterial = new THREE.PointsMaterial({
      size: 3.5,
      sizeAttenuation: false,
      vertexColors: true,

      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
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
        linewidth: 0.9,
        dashed: false,
        depthTest: true,
        
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
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

  addFacePolygons(selectedObject) {
    const meshData = selectedObject.userData.meshData;
    const positions = [];
    const colors = [];
    const indices = [];
    const alphas = [];

    const faceRanges = [];
    let vertexOffset = 0;

    for (let face of meshData.faces.values()) {
      const verts = face.vertexIds.map(id => meshData.getVertex(id));

      faceRanges.push({
        faceId: face.id,
        start: vertexOffset,
        count: verts.length,
        vertexIds: [...face.vertexIds],
        edgeIds: [...face.edgeIds]
      });

      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);
        colors.push(1, 1, 1);
        alphas.push(0.0);
      }

      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(vertexOffset, vertexOffset + i, vertexOffset + i + 1);
      }

      vertexOffset += verts.length;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,

      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,

      vertexShader: `
        attribute float alpha;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `,
    });

    const faceMesh = new THREE.Mesh(geometry, material);
    faceMesh.renderOrder = 5;
    faceMesh.userData.faceRanges = faceRanges;
    faceMesh.userData.isEditorOnly = true;
    faceMesh.name = '__FacePolygons';

    this.sceneManager.sceneHelpers.add(faceMesh);

    faceMesh.matrix.copy(selectedObject.matrixWorld);
    faceMesh.matrix.decompose(faceMesh.position, faceMesh.quaternion, faceMesh.scale);
  }

  removeFacePolygons() {
    const obj = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (obj) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  refreshHelpers() {
    if (!this.object) return;
    this.removeVertexPoints();
    this.removeEdgeLines();
    this.removeFacePolygons();

    const mode = this.editor.editSelection.subSelectionMode;

    if (mode === 'vertex') {
      this.addVertexPoints(this.object);
      this.addEdgeLines(this.object);
      this.addFacePolygons(this.object);

      this.editor.editSelection.highlightSelectedVertex();
    } else if (mode === 'edge') {
      this.addEdgeLines(this.object);
      this.addFacePolygons(this.object);

      this.editor.editSelection.highlightSelectedEdge();
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

  duplicateSelectionVertices(vertexIds) {
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

    const newVertexIds = Array.from(duplicatedVertices.values()).map(v => v.id);
    const newEdgeIds = Array.from(duplicatedEdges.values()).map(e => e.id);
    const newFaceIds = Array.from(duplicatedFaces.values()).map(f => f.id);
    return { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds };
  }

  duplicateSelectionEdges(edgeIds) {
    const meshData = this.object.userData.meshData;

    const selectedEdges = new Set(edgeIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices at the ends of selected edges
    for (let edgeId of selectedEdges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      [edge.v1Id, edge.v2Id].forEach(vId => {
        if (!duplicatedVertices.has(vId)) {
          const oldVertex = meshData.getVertex(vId);
          if (!oldVertex) return;

          const newVertex = meshData.addVertex({
            x: oldVertex.position.x,
            y: oldVertex.position.y,
            z: oldVertex.position.z
          });

          duplicatedVertices.set(vId, newVertex);
        }
      });
    }

    // Duplicate edges
    for (let edgeId of selectedEdges) {
      const oldEdge = meshData.edges.get(edgeId);
      if (!oldEdge) continue;

      const v1 = duplicatedVertices.get(oldEdge.v1Id);
      const v2 = duplicatedVertices.get(oldEdge.v2Id);
      if (!v1 || !v2) continue;

      const newEdge = meshData.addEdge(v1, v2);
      duplicatedEdges.set(edgeId, newEdge);
    }

    // Duplicate faces where all edges are selected
    for (let face of meshData.faces.values()) {
      const allEdgesSelected = [...face.edgeIds].every(eid => selectedEdges.has(eid));
      if (allEdgesSelected) {
        const newVertices = face.vertexIds.map(vId => duplicatedVertices.get(vId));
        if (newVertices.every(v => v)) {
          const newFace = meshData.addFace(newVertices);
          duplicatedFaces.set(face.id, newFace);
        }
      }
    }

    // Map old vertex IDs to new ones
    const mappedVertexIds = {};
    for (let [oldId, newVertex] of duplicatedVertices.entries()) {
      mappedVertexIds[oldId] = newVertex.id;
    }

    const newVertexIds = Array.from(duplicatedVertices.values()).map(v => v.id);
    const newEdgeIds = Array.from(duplicatedEdges.values()).map(e => e.id);
    const newFaceIds = Array.from(duplicatedFaces.values()).map(f => f.id);
    return { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds };
  }

  deleteSelectionVertices(vertexIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(vertexIds);

    const deletedFaces = new Set();
    const deletedEdges = new Set();
    const deletedVertices = new Set();

    // Delete faces fully contained in the selection
    for (const face of [...meshData.faces.values()]) {
      const allVerticesInside = face.vertexIds.every(vId => selected.has(vId));

      if (allVerticesInside) {
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
      const vertex = meshData.getVertex(vId);
      if (!vertex) continue;

      const hasEdges = vertex.edgeIds && vertex.edgeIds.size > 0;
      const hasFaces = vertex.faceIds && vertex.faceIds.size > 0;

      if (!hasEdges && !hasFaces) {
        meshData.deleteVertex(vertex);
        deletedVertices.add(vId);
      }
    }

    return {
      deletedFaces: Array.from(deletedFaces),
      deletedEdges: Array.from(deletedEdges),
      deletedVertices: Array.from(deletedVertices)
    };
  }

  deleteSelectionEdges(edgeIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(edgeIds);

    const deletedFaces = new Set();
    const deletedEdges = new Set();
    const deletedVertices = new Set();

    // Delete faces fully bounded by the selected edges
    for (const face of [...meshData.faces.values()]) {
      const allEdgesInside = [...face.edgeIds].every(eId => selected.has(eId));

      if (allEdgesInside) {
        meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    // Delete the selected edges themselves
    for (const edgeId of selected) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      // Edge should not be deleted while still attached to a face
      if (edge.faceIds.size === 0) {
        meshData.deleteEdge(edge);
        deletedEdges.add(edgeId);
      }
    }

    // Delete vertices that are now isolated (no edges, no faces)
    for (const [vId, vertex] of meshData.vertices.entries()) {
      const hasEdges = vertex.edgeIds && vertex.edgeIds.size > 0;
      const hasFaces = vertex.faceIds && vertex.faceIds.size > 0;

      if (!hasEdges && !hasFaces) {
        meshData.deleteVertex(vertex);
        deletedVertices.add(vId);
      }
    }

    return {
      deletedFaces: [...deletedFaces],
      deletedEdges: [...deletedEdges],
      deletedVertices: [...deletedVertices]
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