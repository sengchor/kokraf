import * as THREE from 'three';
import { LineSegmentsGeometry } from 'jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'jsm/lines/LineSegments2.js';
import earcut from 'earcut';
import { computePlaneNormal, projectTo2D, removeCollinearVertices } from '../geometry/TriangulationUtils.js';
import { MeshData } from '../core/MeshData.js';

export default class EditHelpers {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.editSelectionChanged.add((allSelectedIds) => {
      this.applyVertexHighlight(allSelectedIds.selectedVertexIds);
      this.applyEdgeHighlight(allSelectedIds.selectedEdgeIds);
      this.applyFaceHighlight(allSelectedIds.selectedFaceIds);
    });

    this.signals.editSelectionCleared.add(() => {
      this.clearEditHelpers();
    });

    this.signals.vertexPositionsUpdated.add((verts, edges, faces, meshData, matrixWorld) => {
      this.updateHelpersAfterMeshEdit(verts, edges, faces, meshData, matrixWorld);
    });

    this.signals.refreshEditHelpers.add((editedObject, mode, allSelectedIds, useEarcut) => {
      this.refreshHelpers(editedObject, mode, allSelectedIds, useEarcut);
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
    vertexPoints.matrixAutoUpdate = false;
    vertexPoints.matrix.copy(selectedObject.matrixWorld);
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
    const matrixWorld = selectedObject.matrixWorld;

    const allPositions = [];
    const edgeIdToBufferIndex = new Map();
    const edgeIdList = [];

    let i = 0;
    const _v1 = new THREE.Vector3();
    const _v2 = new THREE.Vector3();

    for (let edge of meshData.edges.values()) {
      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);

      _v1.copy(v1.position).applyMatrix4(matrixWorld);
      _v2.copy(v2.position).applyMatrix4(matrixWorld);

      allPositions.push(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z);
      edgeIdToBufferIndex.set(edge.id, i);
      edgeIdList.push(edge.id);
      i++;
    }

    const posArray = new Float32Array(allPositions);

    // Visible Line
    const fatGeo = new LineSegmentsGeometry().setPositions(posArray);
    const fatMat = new LineMaterial({
      color: 0xffffff,
      linewidth: 0.9,
      vertexColors: true,
      dashed: false,
      depthTest: true,
      
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    fatMat.resolution.set(window.innerWidth, window.innerHeight);

    // Per-edge colors for highlight
    const colorArray = new Float32Array(edgeIdList.length * 2 * 3);
    colorArray.fill(0);
    // Replace the custom colorArray block with this:
    const instanceColorStart = new THREE.InstancedBufferAttribute(
      new Float32Array(edgeIdList.length * 3).fill(0), 3
    );
    const instanceColorEnd = new THREE.InstancedBufferAttribute(
      new Float32Array(edgeIdList.length * 3).fill(0), 3
    );
    fatGeo.setAttribute('instanceColorStart', instanceColorStart);
    fatGeo.setAttribute('instanceColorEnd', instanceColorEnd);

    const fatLine = new LineSegments2(fatGeo, fatMat);
    fatLine.computeLineDistances();
    fatLine.renderOrder = 10;
    fatLine.userData.isEditorOnly = true;
    fatLine.userData.edgeIdToBufferIndex = edgeIdToBufferIndex;
    fatLine.userData.edgeIdList = edgeIdList;
    fatLine.name = '__EdgeLinesVisual';
    this.sceneManager.sceneHelpers.add(fatLine);

    // Invisible Raycast Line
    const thinGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
    const thinMat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false
    });

    const thinLine = new THREE.Line(thinGeo, thinMat);
    thinLine.userData.isEditorOnly = true;
    thinLine.userData.edgeIdToBufferIndex = edgeIdToBufferIndex;
    thinLine.userData.edgeIdList = edgeIdList;
    thinLine.userData.visualLine = fatLine;
    thinLine.name = '__EdgeLines';
    this.sceneManager.sceneHelpers.add(thinLine);
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

  addFacePolygons(selectedObject, useEarcut) {
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
      let triangulated = null;
      let triCount = 0;

      if (useEarcut) {
        verts = removeCollinearVertices(verts);
        const normal = computePlaneNormal(verts);
        const flatVertices2D = projectTo2D(verts, normal);
        triangulated = earcut(flatVertices2D);
        triCount = triangulated.length / 3;
      } else {
        triCount = verts.length - 2;
      }

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

      if (useEarcut) {
        for (let i = 0; i < triangulated.length; i += 3) {
          indices.push(
            vertexOffset + triangulated[i],
            vertexOffset + triangulated[i + 1],
            vertexOffset + triangulated[i + 2]
          );
        }
      } else {
        for (let i = 1; i < verts.length - 1; i++) {
          indices.push(vertexOffset, vertexOffset + i, vertexOffset + i + 1);
        }
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

    faceMesh.matrixAutoUpdate = false;
    faceMesh.matrix.copy(selectedObject.matrixWorld);
  }

  removeFacePolygons() {
    const obj = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (obj) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  refreshHelpers(editedObject, mode, allSelectedIds, useEarcut = true) {
    if (!editedObject) return;

    if (editedObject.userData.meshData && !(editedObject.userData.meshData instanceof MeshData)) {
      MeshData.rehydrateMeshData(editedObject);
    }

    this.removeVertexPoints();
    this.removeEdgeLines();
    this.removeFacePolygons();

    if (mode === 'vertex') {
      this.addVertexPoints(editedObject);
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject, useEarcut);
    } else if (mode === 'edge') {
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject, useEarcut);
    } else if (mode === 'face') {
      this.addEdgeLines(editedObject);
      this.addFacePolygons(editedObject, useEarcut);
    }

    this.applyVertexHighlight(allSelectedIds.selectedVertexIds);
    this.applyEdgeHighlight(allSelectedIds.selectedEdgeIds);
    this.applyFaceHighlight(allSelectedIds.selectedFaceIds);
  }

  updateHelpersAfterMeshEdit(affectedVertices, affectedEdges, affectedFaces, meshData, matrixWorld) {
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
    const thinLine = this.sceneManager.sceneHelpers.getObjectByName('__EdgeLines');
    const fatLine = this.sceneManager.sceneHelpers.getObjectByName('__EdgeLinesVisual');

    if (thinLine && fatLine) {
      const { edgeIdToBufferIndex } = thinLine.userData;
      const thinPosAttr = thinLine.geometry.getAttribute('position');
      const fatPosArray = fatLine.geometry.attributes.instanceStart.data.array; // LineSegmentsGeometry interleaved

      const _v1 = new THREE.Vector3();
      const _v2 = new THREE.Vector3();

      for (let edgeId of affectedEdges) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        const bufferIndex = edgeIdToBufferIndex.get(edgeId);
        if (bufferIndex === undefined) continue;

        const v1 = meshData.getVertex(edge.v1Id);
        const v2 = meshData.getVertex(edge.v2Id);

        _v1.copy(v1.position).applyMatrix4(matrixWorld);
        _v2.copy(v2.position).applyMatrix4(matrixWorld);

        // Thin line: 2 vertices per edge
        thinPosAttr.setXYZ(bufferIndex * 2, _v1.x, _v1.y, _v1.z);
        thinPosAttr.setXYZ(bufferIndex * 2 + 1, _v2.x, _v2.y, _v2.z);

        // Fat line: LineSegmentsGeometry interleaved buffer, 6 floats per segment
        const offset = bufferIndex * 6;
        fatPosArray[offset] = _v1.x; fatPosArray[offset + 1] = _v1.y; fatPosArray[offset + 2] = _v1.z;
        fatPosArray[offset + 3] = _v2.x; fatPosArray[offset + 4] = _v2.y; fatPosArray[offset + 5] = _v2.z;
      }

      thinPosAttr.needsUpdate = true;
      fatLine.geometry.attributes.instanceStart.data.needsUpdate = true;
      fatLine.geometry.attributes.instanceEnd.data.needsUpdate   = true;
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

  applyVertexHighlight(selectedVertexIds) {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const indices = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < indices.count; i++) {
      if (selectedVertexIds.has(indices.getX(i))) {
        colors.setXYZ(i, 1, 1, 1);
      } else {
        colors.setXYZ(i, 0, 0, 0);
      }
    }

    colors.needsUpdate = true;
  }

  applyEdgeHighlight(selectedEdgeIds) {
    const fatLine = this.sceneManager.sceneHelpers.getObjectByName('__EdgeLinesVisual');
    if (!fatLine) return;

    const { edgeIdList, edgeIdToBufferIndex } = fatLine.userData;
    const colorStart = fatLine.geometry.getAttribute('instanceColorStart');
    const colorEnd   = fatLine.geometry.getAttribute('instanceColorEnd');

    for (let edgeId of edgeIdList) {
      const idx = edgeIdToBufferIndex.get(edgeId);
      const selected = selectedEdgeIds.has(edgeId);
      const r = selected ? 1 : 0, g = selected ? 1 : 0, b = selected ? 1 : 0;
      colorStart.setXYZ(idx, r, g, b);
      colorEnd.setXYZ(idx, r, g, b);
    }

    colorStart.needsUpdate = true;
    colorEnd.needsUpdate = true;
  }

  applyFaceHighlight(selectedFaceIds) {
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

        if (selectedFaceIds.has(faceId)) {
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

  clearEditHelpers() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (vertexPoints) {
      const colors = vertexPoints.geometry.attributes.color;
      for (let i = 0; i < colors.count; i++) {
        colors.setXYZ(i, 0, 0, 0);
      }
      colors.needsUpdate = true;
    }

    const fatLine = this.sceneManager.sceneHelpers.getObjectByName('__EdgeLinesVisual');
    if (fatLine) {
      const colorStart = fatLine.geometry.getAttribute('instanceColorStart');
      const colorEnd   = fatLine.geometry.getAttribute('instanceColorEnd');
      colorStart.array.fill(0);
      colorEnd.array.fill(0);
      colorStart.needsUpdate = true;
      colorEnd.needsUpdate = true;
    }

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