import * as THREE from 'three';
import { LineSegmentsGeometry } from 'jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'jsm/lines/LineSegments2.js';
import earcut from 'earcut';
import { computePlaneNormal, projectTo2D, removeCollinearVertices } from "../geometry/GeometryGenerator.js";
import { MeshData } from '../core/MeshData.js';

export default class EditHelpers {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;
    this.editSelection = editor.editSelection;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.editSelectionChanged.add((mode) => {
      if (mode === 'vertex') {
        this.highlightSelectedVertex();
      } else if (mode === 'edge') {
        this.highlightSelectedEdge();
      } else if (mode === 'face') {
        this.highlightSelectedFace();
      }
    });

    this.signals.editSelectionCleared.add(() => {
      this.clearEditHelpers();
    });
  }

  addVertexPoints(selectedObject) {
    const meshData = selectedObject.userData.meshData;
    const positions = [];
    const colors = [];
    const vertexIds = [];
    const vertexIdToBufferIndex = new Map();

    let i = 0;
    for (let v of meshData.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      colors.push(0, 0, 0);
      vertexIds.push(v.id);
      vertexIdToBufferIndex.set(v.id, i);
      i++;
    }
    
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    pointGeometry.setAttribute('vertexId', new THREE.Uint16BufferAttribute(vertexIds, 1));

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
    vertexPoints.userData.vertexIdToBufferIndex = vertexIdToBufferIndex;
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
      });
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
    let triangleOffset = 0;

    for (let face of meshData.faces.values()) {
      let verts = face.vertexIds.map(id => meshData.getVertex(id));
      verts = removeCollinearVertices(verts);
      const normal = computePlaneNormal(verts);
      const flatVertices2D = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices2D);
      const triCount = triangulated.length / 3;

      faceRanges.push({
        faceId: face.id,
        start: vertexOffset,
        count: verts.length,
        triStart: triangleOffset,
        triCount: triCount,
        vertexIds: [...face.vertexIds],
        edgeIds: [...face.edgeIds]
      });

      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);
        colors.push(1, 1, 1);
        alphas.push(0.0);
      }

      for (let i = 0; i < triangulated.length; i += 3) {
        indices.push(
          vertexOffset + triangulated[i],
          vertexOffset + triangulated[i + 1],
          vertexOffset + triangulated[i + 2]
        );
      }

      vertexOffset += verts.length;
      triangleOffset += triCount;
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
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    if (editedObject.userData.meshData && !(editedObject.userData.meshData instanceof MeshData)) {
      MeshData.rehydrateMeshData(editedObject);
    }

    this.removeVertexPoints();
    this.removeEdgeLines();
    this.removeFacePolygons();

    const mode = this.editSelection.subSelectionMode;

    if (mode === 'vertex') {
      this.addVertexPoints(editedObject);
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject);

      this.highlightSelectedVertex();
    } else if (mode === 'edge') {
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject);

      this.highlightSelectedEdge();
    } else if (mode === 'face') {
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject);

      this.highlightSelectedFace();
    }
  }

  updateHelpersAfterMeshEdit(affectedVertices, affectedEdges, affectedFaces, meshData) {
    // Update affected vertices
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      const posAttr = vertexPoints.geometry.getAttribute('position');
      const vertexIdToBufferIndex = vertexPoints.userData.vertexIdToBufferIndex;

      for (let vertexId of affectedVertices) {
        const bufferIndex = vertexIdToBufferIndex.get(vertexId);
        const v = meshData.getVertex(vertexId);
        posAttr.setXYZ(bufferIndex, v.position.x, v.position.y, v.position.z);
      }
      posAttr.needsUpdate = true;
    }

    // Update affected edges
    const edgeLines = [];
    this.sceneManager.sceneHelpers.traverse((obj) => {
      if (obj.userData.isEditorOnly && obj.name === '__EdgeLines') {
        edgeLines.push(obj);
      }
    });

    for (let edgeId of affectedEdges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const thinLine = edgeLines.find(line => line.userData.edge === edge);
      if (!thinLine) continue;

      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);

      const positions = [
        v1.position.x, v1.position.y, v1.position.z,
        v2.position.x, v2.position.y, v2.position.z
      ];

      const posAttr = thinLine.geometry.getAttribute("position");
      posAttr.setXYZ(0, positions[0], positions[1], positions[2]);
      posAttr.setXYZ(1, positions[3], positions[4], positions[5]);
      posAttr.needsUpdate = true;

      const fatLine = thinLine.userData.visualLine;
      if (fatLine && fatLine.geometry) {
        fatLine.geometry.setPositions(positions);
      }
    }

    // Update affected faces
    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (faceMesh) {
      const facePosAttr = faceMesh.geometry.getAttribute('position');
      const faceRanges = faceMesh.userData.faceRanges;

      for (let fr of faceRanges) {
        if (!affectedFaces.has(fr.faceId)) continue;

        const { start, vertexIds } = fr;
        for (let i = 0; i < vertexIds.length; i++) {
          const v = meshData.getVertex(vertexIds[i]);
          facePosAttr.setXYZ(start + i, v.position.x, v.position.y, v.position.z);
        }
      }

      facePosAttr.needsUpdate = true;
      faceMesh.geometry.computeBoundingSphere();
    }
  }

  highlightSelectedVertex() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const indices = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < indices.count; i++) {
      if (this.editSelection.selectedVertexIds.has(indices.getX(i))) {
        colors.setXYZ(i, 1, 1, 1);
      } else {
        colors.setXYZ(i, 0, 0, 0);
      }
    }

    colors.needsUpdate = true;

    this.highlightEdgesFromVertices();
    this.highlightFacesFromVertices();
  }

  highlightSelectedEdge() {
    const edgeLines = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLinesVisual' && obj.userData.edge) {
        edgeLines.push(obj);
      }
    });

    for (let edgeLine of edgeLines) {
      const { edge } = edgeLine.userData;
      const material = edgeLine.material;

      if (this.editSelection.selectedEdgeIds.has(edge.id)) {
        material.color.set(0xffffff);
      } else {
        material.color.set(0x000000);
      }

      material.needsUpdate = true;
    }

    this.highlightFacesFromEdges();
  }

  highlightSelectedFace() {
    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return;

    const faceRanges = faceMesh.userData.faceRanges;
    if (!faceRanges) return;

    const colors = faceMesh.geometry.getAttribute('color');
    const alphas = faceMesh.geometry.getAttribute('alpha');

    for (let fr of faceRanges) {
      const { faceId, start, count } = fr;

      for (let i = 0; i < count; i++) {
        const idx = start + i;

        if (this.editSelection.selectedFaceIds.has(faceId)) {
          colors.setXYZ(idx, 1, 1, 0);
          alphas.setX(idx, 0.15);
        } else {
          colors.setXYZ(idx, 1, 1, 1);
          alphas.setX(idx, 0.0);
        }
      }
    }

    colors.needsUpdate = true;
    alphas.needsUpdate = true;

    this.highlightEdgesFromFaces();
  }

  highlightEdgesFromVertices() {
    const edgeLines = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLinesVisual' && obj.userData.edge) {
        edgeLines.push(obj);
      }
    });

    this.editSelection.selectedEdgeIds.clear();

    for (let edgeLine of edgeLines) {
      const { edge } = edgeLine.userData;
      const bothSelected = this.editSelection.selectedVertexIds.has(edge.v1Id) && this.editSelection.selectedVertexIds.has(edge.v2Id);

      const material = edgeLine.material;
      if (bothSelected) {
        material.color.set(0xffffff);
        this.editSelection.selectedEdgeIds.add(edge.id);
      } else {
        material.color.set(0x000000);
      }
      material.needsUpdate = true;
    }
  }

  highlightFacesFromVertices() {
    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return;

    const faceRanges = faceMesh.userData.faceRanges;
    const colors = faceMesh.geometry.getAttribute('color');
    const alphas = faceMesh.geometry.getAttribute('alpha');

    this.editSelection.selectedFaceIds.clear();

    for (let fr of faceRanges) {
      const { faceId, start, count, vertexIds } = fr;

      const allSelected = vertexIds.every(v => this.editSelection.selectedVertexIds.has(v));

      for (let i = 0; i < count; i++) {
        const idx = start + i;

        if (allSelected) {
          colors.setXYZ(idx, 1, 1, 0);
          alphas.setX(idx, 0.15);
          this.editSelection.selectedFaceIds.add(faceId);
        } else {
          colors.setXYZ(idx, 1, 1, 1);
          alphas.setX(idx, 0.0);
        }
      }
    }
    colors.needsUpdate = true;
    alphas.needsUpdate = true;
  }

  highlightFacesFromEdges() {
    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return;


    const faceRanges = faceMesh.userData.faceRanges;
    const colors = faceMesh.geometry.getAttribute('color');
    const alphas = faceMesh.geometry.getAttribute('alpha');

    this.editSelection.selectedFaceIds.clear();

    for (let fr of faceRanges) {
      const { faceId, start, count, edgeIds } = fr;

      const allSelected = edgeIds.every(eid => this.editSelection.selectedEdgeIds.has(eid));

      if (allSelected) this.editSelection.selectedFaceIds.add(faceId);

      for (let i = 0; i < count; i++) {
        const idx = start + i;

        if (allSelected) {
          colors.setXYZ(idx, 1, 1, 0);
          alphas.setX(idx, 0.15);
        } else {
          colors.setXYZ(idx, 1, 1, 1);
          alphas.setX(idx, 0.0);
        }
      }
    }

    colors.needsUpdate = true;
    alphas.needsUpdate = true;
  }

  highlightEdgesFromFaces() {
    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return;

    const faceRanges = faceMesh.userData.faceRanges;

    // Collect all edges belonging to selected faces
    const selectedFaceVertexIds = new Set();
    const selectedFaceEdgeIds = new Set();

    for (let fr of faceRanges) {
      if (this.editSelection.selectedFaceIds.has(fr.faceId)) {
        for (const vid of fr.vertexIds) {
          selectedFaceVertexIds.add(vid);
        }

        for (const eid of fr.edgeIds) {
          selectedFaceEdgeIds.add(eid);
        }
      }
    }

    // Now highlight those edges
    this.editSelection.selectedVertexIds = selectedFaceVertexIds;
    this.editSelection.selectedEdgeIds.clear();

    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name !== '__EdgeLinesVisual' || !obj.userData.edge) return;

      const edge = obj.userData.edge;
      const material = obj.material;

      if (selectedFaceEdgeIds.has(edge.id)) {
        material.color.set(0xffffff);
        this.editSelection.selectedEdgeIds.add(edge.id);
      } else {
        material.color.set(0x000000);
      }

      material.needsUpdate = true;
    });
  }

  clearEditHelpers() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      const colors = vertexPoints.geometry.attributes.color;
      for (let i = 0; i < colors.count; i++) {
        colors.setXYZ(i, 0, 0, 0);
      }
      colors.needsUpdate = true;
    }

    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLinesVisual' && obj.userData.edge) {
        const material = obj.material;
        material.color.set(0x000000);
        material.needsUpdate = true;
      }
    });

    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (faceMesh) {
      const colors = faceMesh.geometry.getAttribute('color');
      const alphas = faceMesh.geometry.getAttribute('alpha');
      for (let i = 0; i < colors.count; i++) {
        colors.setXYZ(i, 1, 1, 1);
        alphas.setX(i, 0.0);
      }

      colors.needsUpdate = true;
      alphas.needsUpdate = true;
    }
  }
}