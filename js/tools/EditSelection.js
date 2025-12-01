import * as THREE from 'three';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.editedObject = null;
    this.sceneManager = editor.sceneManager;
    this.enable = true;
    this.subSelectionMode = 'vertex';

    this.vertexHandle = new THREE.Object3D();
    this.vertexHandle.name = '__VertexHandle';
    this.vertexHandle.visible = false;
    this.sceneManager.sceneEditorHelpers.add(this.vertexHandle);

    this.multiSelectEnabled = false;
    this.selectedVertexIds = new Set();
    this.selectedEdgeIds = new Set();
    this.selectedFaceIds = new Set();
    this.setupListeners();
  }

  setupListeners() {
    this.signals.multiSelectChanged.add((shiftChanged) => {
      this.multiSelectEnabled = shiftChanged;
    });

    this.signals.emptyScene.add(() => {
      this.editedObject = null;
    });
  }

  setSubSelectionMode(mode) {
    this.subSelectionMode = mode;
  }

  onMouseSelect(event, renderer, camera) {
    if (!this.enable) return;

    if (this.subSelectionMode === 'vertex') {
      const nearestVertexId = this.pickNearestVertexAtMouse(event, renderer, camera);
      if (nearestVertexId === null) {
        this.clearSelection();
        return;
      }

      this.selectVertices(nearestVertexId);
    } else if (this.subSelectionMode === 'edge') {
      const nearestEdgeId = this.pickNearestEdgeOnMouse(event, renderer, camera);
      if (nearestEdgeId === null) {
        this.clearSelection();
        return;
      }

      this.selectEdges(nearestEdgeId);
    } else if (this.subSelectionMode === 'face') {
      const nearestFaceId = this.pickNearestFaceOnMouse(event, renderer, camera);
      if (nearestFaceId === null) {
        this.clearSelection();
        return;
      }

      this.selectFaces(nearestFaceId);
    }
  }

  pickNearestVertexAtMouse(event, renderer, camera, threshold = 0.1) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return null;

    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Points.threshold = threshold;

    const vertexHits = this.raycaster.intersectObject(vertexPoints);
    if (vertexHits.length === 0) return null;

    const visibleVertices = this.filterVisibleVertices(vertexHits, vertexPoints, camera);
    if (visibleVertices.length === 0) return null;

    const nearestVertexId = this.pickNearestVertex(visibleVertices, camera, rect, vertexPoints);

    return nearestVertexId;
  }

  pickNearestEdgeOnMouse(event, renderer, camera, threshold = 0.1) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const edgeLines = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLines' && obj.userData.edge) {
        edgeLines.push(obj);
      }
    });

    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Line.threshold = threshold;
    
    const edgeHits = this.raycaster.intersectObjects(edgeLines, false);
    if (edgeHits.length === 0) return null;

    const visibleEdges = this.filterVisibleEdges(edgeHits, camera);
    if (visibleEdges.length === 0) return null;

    const nearestEdgeId = this.pickNearestEdge(visibleEdges, camera, rect);

    return nearestEdgeId;
  }

  pickNearestFaceOnMouse(event, renderer, camera) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return null;

    this.raycaster.setFromCamera(this.mouse, camera);

    const faceHits = this.raycaster.intersectObject(faceMesh);
    if (faceHits.length === 0) return null;
    
    const visibleFaces = this.filterVisibleFaces(faceHits, faceMesh, camera);
    if (visibleFaces.length === 0) return null;

    const nearestFaceId = this.pickNearestFace(visibleFaces, camera, rect, faceMesh);

    return nearestFaceId;
  }

  highlightSelectedVertex() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const indices = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < indices.count; i++) {
      if (this.selectedVertexIds.has(indices.getX(i))) {
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

      if (this.selectedEdgeIds.has(edge.id)) {
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

        if (this.selectedFaceIds.has(faceId)) {
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

    this.selectedEdgeIds.clear();

    for (let edgeLine of edgeLines) {
      const { edge } = edgeLine.userData;
      const bothSelected = this.selectedVertexIds.has(edge.v1Id) && this.selectedVertexIds.has(edge.v2Id);

      const material = edgeLine.material;
      if (bothSelected) {
        material.color.set(0xffffff);
        this.selectedEdgeIds.add(edge.id);
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

    this.selectedFaceIds.clear();

    for (let fr of faceRanges) {
      const { faceId, start, count, vertexIds } = fr;

      const allSelected = vertexIds.every(v => this.selectedVertexIds.has(v));

      for (let i = 0; i < count; i++) {
        const idx = start + i;

        if (allSelected) {
          colors.setXYZ(idx, 1, 1, 0);
          alphas.setX(idx, 0.15);
          this.selectedFaceIds.add(faceId);
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

    this.selectedFaceIds.clear();

    for (let fr of faceRanges) {
      const { faceId, start, count, edgeIds } = fr;

      const allSelected = edgeIds.every(eid => this.selectedEdgeIds.has(eid));

      if (allSelected) this.selectedFaceIds.add(faceId);

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
      if (this.selectedFaceIds.has(fr.faceId)) {
        for (const vid of fr.vertexIds) {
          selectedFaceVertexIds.add(vid);
        }

        for (const eid of fr.edgeIds) {
          selectedFaceEdgeIds.add(eid);
        }
      }
    }

    // Now highlight those edges
    this.selectedVertexIds = selectedFaceVertexIds;
    this.selectedEdgeIds.clear();

    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name !== '__EdgeLinesVisual' || !obj.userData.edge) return;

      const edge = obj.userData.edge;
      const material = obj.material;

      if (selectedFaceEdgeIds.has(edge.id)) {
        material.color.set(0xffffff);
        this.selectedEdgeIds.add(edge.id);
      } else {
        material.color.set(0x000000);
      }

      material.needsUpdate = true;
    });
  }

  selectVertices(vertexIds) {
    const isArray = Array.isArray(vertexIds);
    if (!isArray) vertexIds = [vertexIds];

    if (isArray) {
      // Replace current vertex selection
      this.clearSelection();
      vertexIds.forEach(id => this.selectedVertexIds.add(id));
    } else {
      const vertexId = vertexIds[0];

      if (this.multiSelectEnabled) {
        // Toggle selection
        if (this.selectedVertexIds.has(vertexId)) {
          this.selectedVertexIds.delete(vertexId);
        } else {
          this.selectedVertexIds.add(vertexId);
        }
      } else {
        // Single selection
        this.selectedVertexIds.clear();
        this.selectedVertexIds.add(vertexId);
      }
    }

    this.highlightSelectedVertex();
    this.updateVertexHandle();
  }

  selectEdges(edgeIds) {
    const isArray = Array.isArray(edgeIds);
    if (!isArray) edgeIds = [edgeIds];

    if (isArray) {
      // Replace current edge selection
      this.clearSelection();
      edgeIds.forEach(id => this.selectedEdgeIds.add(id));
    } else {
      const edgeId = edgeIds[0];

      if (this.multiSelectEnabled) {
        // Toggle selection
        if (this.selectedEdgeIds.has(edgeId)) {
          this.selectedEdgeIds.delete(edgeId);
        } else {
          this.selectedEdgeIds.add(edgeId);
        }
      } else {
        // Single selection
        this.selectedEdgeIds.clear();
        this.selectedEdgeIds.add(edgeId);
      }
    }

    const vIds = this.getSelectedEdgeVertexIds();
    this.selectedVertexIds.clear();
    vIds.forEach(id => this.selectedVertexIds.add(id));

    this.highlightSelectedEdge();
    this.updateVertexHandle();
  }

  selectFaces(faceIds) {
    const isArray = Array.isArray(faceIds);
    if (!isArray) faceIds = [faceIds];

    if (isArray) {
      // Replace current face selection
      this.clearSelection();
      faceIds.forEach(id => this.selectedFaceIds.add(id));
    } else {
      const faceId = faceIds[0];

      if (this.multiSelectEnabled) {
        if (this.selectedFaceIds.has(faceId)) {
          this.selectedFaceIds.delete(faceId);
        } else {
          this.selectedFaceIds.add(faceId);
        }
      } else {
        // Single selection
        this.selectedFaceIds.clear();
        this.selectedFaceIds.add(faceId);
      }
    }

    const vIds = this.getSelectedFaceVertexIds();
    this.selectedVertexIds.clear();
    vIds.forEach(id => this.selectedVertexIds.add(id));

    this.highlightSelectedFace();
    this.updateVertexHandle();
  }

  clearSelection() {
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

    this.selectedVertexIds.clear();
    this.selectedEdgeIds.clear();
    this.selectedFaceIds.clear();
    this.vertexHandle.visible = false;
  }

  updateVertexHandle() {
    if (!this.vertexHandle || !this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    let vertexIds = [];

    if (this.subSelectionMode === 'vertex') {
      vertexIds = this.getSelectedVertexIds();
    } else if (this.subSelectionMode === 'edge') {
      vertexIds = this.getSelectedEdgeVertexIds();
    } else if (this.subSelectionMode === 'face') {
      vertexIds = this.getSelectedFaceVertexIds();
    }

    vertexIds = [...new Set(vertexIds)];

    if (vertexIds.length === 0) {
      this.vertexHandle.visible = false;
      return;
    }

    const worldPos = new THREE.Vector3();
    const sum = new THREE.Vector3();
    const localPos = new THREE.Vector3();

    for (const id of vertexIds) {
      const v = meshData.getVertex(id);
      if (!v) continue;

      localPos.set(v.position.x, v.position.y, v.position.z);
      worldPos.copy(localPos).applyMatrix4(this.editedObject.matrixWorld);

      sum.add(worldPos);
    }
    sum.divideScalar(vertexIds.length);

    this.vertexHandle.position.copy(sum);
    this.vertexHandle.visible = true;
  }

  filterVisibleVertices(vertexHits, vertexPoints, camera) {
    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const reverseRay = new THREE.Raycaster();
    const visibleVertices = [];

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const epsilon = 0.001;
    const occluders = mainObjects.filter(obj => obj !== vertexPoints);

    for (const hit of vertexHits) {
      const vertexPos = new THREE.Vector3(
        posAttr.getX(hit.index),
        posAttr.getY(hit.index),
        posAttr.getZ(hit.index)
      ).applyMatrix4(vertexPoints.matrixWorld);

      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, vertexPos).normalize();
      const rayOrigin = vertexPos.clone().add(dirToCamera.clone().multiplyScalar(epsilon));
      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = vertexPos.distanceTo(cameraPos);
      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        visibleVertices.push({ ...hit, point: vertexPos });
      }
    }

    return visibleVertices;
  }

  filterVisibleEdges(edgeHits, camera) {
    if (edgeHits.length === 0) return [];

    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const epsilon = 0.001;
    const reverseRay = new THREE.Raycaster();
    const visibleEdges = [];

    // occluders: everything in the scene except the edge helper lines
    const occluders = mainObjects.filter(obj => obj.name !== '__EdgeLines');

    for (const hit of edgeHits) {
      const thinLine = hit.object;
      const geo = thinLine.geometry;
      const pos = geo.getAttribute('position');

      // world-space endpoints
      const vA = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0))
        .applyMatrix4(thinLine.matrixWorld);

      const vB = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1))
        .applyMatrix4(thinLine.matrixWorld);

      // midpoint visibility test
      const mid = new THREE.Vector3().addVectors(vA, vB).multiplyScalar(0.5);

      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, mid).normalize();
      const rayOrigin = mid.clone().addScaledVector(dirToCamera, epsilon);

      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = mid.distanceTo(cameraPos);

      // If any hit is closer than the camera, the edge is occluded.
      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        visibleEdges.push({
          thinLine,
          visualLine: thinLine.userData.visualLine,
          edge: thinLine.userData.edge,
          vA,
          vB,
          mid,
          screenDist: hit.distance,
        });
      }
    }

    return visibleEdges;
  }

  filterVisibleFaces(faceHits, faceMesh, camera) {
    if (!faceHits || faceHits.length === 0) return [];

    const visibleFaces = [];
    const mainObjects = this.sceneManager.mainScene.children;

    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const reverseRay = new THREE.Raycaster();
    const epsilon = 0.001;
    const occluders = mainObjects.filter(obj => obj !== faceMesh);

    for (const hit of faceHits) {
      const facePoint = hit.point.clone();

      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, facePoint).normalize();
      const rayOrigin = facePoint.clone().addScaledVector(dirToCamera, epsilon);

      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = facePoint.distanceTo(cameraPos);

      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        visibleFaces.push(hit);
      }
    }

    return visibleFaces;
  }

  pickNearestVertex(vertexHits, camera, rect, vertexPoints) {
    let nearestVertexId = null;
    let minScreenDistSq = Infinity;

    const vertexIdAttr = vertexPoints.geometry.getAttribute('vertexId');

    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const screenPos = new THREE.Vector3();
    vertexHits.forEach(hit => {
      screenPos.copy(hit.point).project(camera);
      const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
      const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;

      const dx = sx - clickX;
      const dy = sy - clickY;
      const distPxSq = dx * dx + dy * dy;

      if (distPxSq < minScreenDistSq) {
        minScreenDistSq = distPxSq;
        nearestVertexId = vertexIdAttr.getX(hit.index);
      }
    });
    
    return nearestVertexId;
  }

  pickNearestEdge(edgeHits, camera, rect) {
    if (!edgeHits || edgeHits.length === 0) return null;

    let nearestEdgeId = null;
    let minDistSq = Infinity;

    edgeHits.forEach(edgeHit => {
      const result = this.getClosestPointOnScreenLine(edgeHit, camera, rect);

      if (result.distSq < minDistSq) {
        minDistSq = result.distSq;
        nearestEdgeId = result.edgeId;
      }
    });

    return nearestEdgeId;
  }

  pickNearestFace(faceHits, camera, rect, faceMesh) {
    let nearestFaceId = null;
    let minScreenDistSq = Infinity;

    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const screenPos = new THREE.Vector3();

    faceHits.forEach(hit => {
      screenPos.copy(hit.point).project(camera);

      const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
      const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;

      const dx = sx - clickX;
      const dy = sy - clickY;
      const distSq = dx * dx + dy * dy;

      const faceId = this.findFaceIdFromTriIndex(hit.faceIndex, faceMesh.userData.faceRanges);
      if (faceId === null) return;

      if (distSq < minScreenDistSq) {
        minScreenDistSq = distSq;
        nearestFaceId = faceId;
      }
    });

    return nearestFaceId;
  }

  findFaceIdFromTriIndex(triIndex, faceRanges) {
    for (const fr of faceRanges) {
      if (triIndex >= fr.triStart && triIndex < fr.triStart + fr.triCount) {
        return fr.faceId;
      }
    }
    return null;
  }

  getClosestPointOnScreenLine(edgeHit, camera, rect) {
    // Mouse in pixel coordinates
    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();

    // Project both endpoints to NDC → screen
    pA.copy(edgeHit.vA).project(camera);
    pB.copy(edgeHit.vB).project(camera);

    const x1 = (pA.x * 0.5 + 0.5) * rect.width;
    const y1 = (-pA.y * 0.5 + 0.5) * rect.height;

    const x2 = (pB.x * 0.5 + 0.5) * rect.width;
    const y2 = (-pB.y * 0.5 + 0.5) * rect.height;

    // Vector AB and AP
    const ABx = x2 - x1;
    const ABy = y2 - y1;
    const APx = clickX - x1;
    const APy = clickY - y1;

    const abLenSq = ABx * ABx + ABy * ABy;

    // Handle zero-length (rare but safe)
    let t = 0;
    if (abLenSq > 0) {
      t = (APx * ABx + APy * ABy) / abLenSq;
    }

    // Clamp to segment
    t = Math.max(0, Math.min(1, t));

    // Closest point
    const cx = x1 + ABx * t;
    const cy = y1 + ABy * t;

    const dx = cx - clickX;
    const dy = cy - clickY;

    return {
      cx,
      cy,
      distSq: dx * dx + dy * dy,
      t,
      edgeId: edgeHit.edge.id
    };
  }

  getSelectedVertexIds() {
    return Array.from(this.selectedVertexIds);
  }

  getSelectedEdgeVertexIds() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return [];

    const result = new Set();
    for (const edgeId of this.selectedEdgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      result.add(edge.v1Id);
      result.add(edge.v2Id);
    }
    return Array.from(result);
  }

  getSelectedFaceVertexIds() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return [];

    const result = new Set();
    for (const faceId of this.selectedFaceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      for (const vId of face.vertexIds) {
        result.add(vId);
      }
    }
    return Array.from(result);
  }
}