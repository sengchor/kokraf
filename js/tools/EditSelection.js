import * as THREE from 'three';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.keyHandler = editor.keyHandler;
    this.viewportControls = editor.viewportControls;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.editedObject = null;
    this.sceneManager = editor.sceneManager;
    this.enable = false;
    this.subSelectionMode = 'vertex';

    this.vertexHandle = new THREE.Object3D();
    this.vertexHandle.name = '__VertexHandle';
    this.vertexHandle.visible = false;
    this.sceneManager.sceneEditorHelpers.add(this.vertexHandle);

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.selectionBox = editor.selectionBox;

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

    this.signals.transformDragStarted.add((mode) => {
      if (mode !== 'edit') return;
      this.enable = false;
    });

    this.signals.transformDragEnded.add((mode) => {
      if (mode !== 'edit') return;
      this.enable = true;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener("mousedown", this.onMouseDown.bind(this));
    dom.addEventListener("mousemove", this.onMouseMove.bind(this));
    dom.addEventListener("mouseup", this.onMouseUp.bind(this));
  }

  setSubSelectionMode(mode) {
    this.subSelectionMode = mode;
  }

  applyClickSelection(event) {
    if (!this.enable) return;

    if (this.subSelectionMode === 'vertex') {
      const nearestVertexId = this.pickNearestVertexOnMouse(event, this.renderer, this.camera);
      if (nearestVertexId === null) {
        this.clearSelection();
        return;
      }

      this.selectVertices(nearestVertexId);
    } else if (this.subSelectionMode === 'edge') {
      const nearestEdgeId = this.pickNearestEdgeOnMouse(event, this.renderer, this.camera);
      if (nearestEdgeId === null) {
        this.clearSelection();
        return;
      }

      this.selectEdges(nearestEdgeId);
    } else if (this.subSelectionMode === 'face') {
      const nearestFaceId = this.pickNearestFaceOnMouse(event, this.renderer, this.camera);
      if (nearestFaceId === null) {
        this.clearSelection();
        return;
      }

      this.selectFaces(nearestFaceId);
    }
  }

  applyBoxSelection() {
    if (!this.enable) return;

    if (this.subSelectionMode === 'vertex') {
      const vertexIndices = this.getBoxSelectedVertexIds();
      if (vertexIndices === null) {
        this.clearSelection();
        return;
      }

      this.selectVertices(vertexIndices, true);
    } else if (this.subSelectionMode === 'edge') {
      const edgeIndices = this.getBoxSelectedEdgeIds();
      if (edgeIndices === null) {
        this.clearSelection();
        return;
      }

      this.selectEdges(edgeIndices, true);
    } else if (this.subSelectionMode === 'face') {
      const faceIndices = this.getBoxSelectedFaceIds();
      if (faceIndices === null) {
        this.clearSelection();
        return;
      }

      this.selectFaces(faceIndices, true);
    }
  }

  onMouseDown(event) {
    if (!this.enable || event.button !== 0) return;
    if (!this.keyHandler.startInteraction('select')) return;

    this.dragging = false;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
  }

  onMouseMove(event) {
    if (!this.enable || !this.mouseDownPos) return;
    if (this.keyHandler.activeInteraction !== 'select') return;

    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    const dragThreshold = 1;

    if (!this.dragging && Math.hypot(dx, dy) > dragThreshold) {
      this.dragging = true;
      this.selectionBox.startSelection(event.clientX, event.clientY);
    }

    if (this.dragging) {
      this.selectionBox.updateSelection(event.clientX, event.clientY);
    }
  }

  onMouseUp(event) {
    if (!this.enable || event.button !== 0) return;
    this.keyHandler.endInteraction('select');
    
    this.selectionBox.finishSelection();

    if (this.dragging) {
      this.applyBoxSelection();
    } else {
      this.applyClickSelection(event);
    }

    this.dragging = false;
    this.mouseDownPos = null;
  }

  pickNearestVertexOnMouse(event, renderer, camera, threshold = 0.1) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return null;

    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Points.threshold = threshold;

    const vertexHits = this.raycaster.intersectObject(vertexPoints);
    if (vertexHits.length === 0) return null;

    const xrayMode = this.sceneManager.xrayMode;
    const visibleVertices = xrayMode ? vertexHits : this.filterVisibleVertices(vertexHits, vertexPoints, camera);
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

    const xrayMode = this.sceneManager.xrayMode;
    const edgeCandidates = this.buildEdgeCandidates(edgeHits);
    const visibleEdges = xrayMode ? edgeCandidates : this.filterVisibleEdges(edgeCandidates, camera);
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
    
    const xrayMode = this.sceneManager.xrayMode;
    const visibleFaces = xrayMode ? faceHits : this.filterVisibleFaces(faceHits, faceMesh, camera);
    if (visibleFaces.length === 0) return null;

    const nearestFaceId = this.pickNearestFace(visibleFaces, camera, rect, faceMesh);

    return nearestFaceId;
  }

  getBoxSelectedVertexIds() {
    const frustum = this.selectionBox.computeFrustumFromSelection(this.camera);
    if (!frustum) return null;

    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return null;

    const vertexHits = this.selectionBox.getVerticesInFrustum(vertexPoints, frustum);
    if (vertexHits.length === 0) return null;

    const xrayMode = this.sceneManager.xrayMode;
    const visibleVertices = xrayMode ? vertexHits : this.filterVisibleVertices(vertexHits, vertexPoints, this.camera);
    if (visibleVertices.length === 0) return null;

    const vertexIndices = visibleVertices.map(v => v.index);
    return vertexIndices;
  }

  getBoxSelectedEdgeIds() {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;

    const edgeLines = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLines' && obj.userData.edge) {
        edgeLines.push(obj);
      }
    });

    const edgeHits = this.selectionBox.getEdgesInFrustum(edgeLines, frustum);
    if (edgeHits.length === 0) return null;

    const xrayMode = this.sceneManager.xrayMode;
    const edgeCandidates = this.buildEdgeCandidates(edgeHits);
    const visibleEdges = xrayMode ? edgeCandidates : this.filterVisibleEdges(edgeCandidates, this.camera);
    if (visibleEdges.length === 0) return null;

    const insideHits = visibleEdges.filter(e => e.type === "endpoint");
    const clipHits = visibleEdges.filter(e => e.type === "clipping");

    // Prefer inside hits; if none exist, use clipping hits.
    const selectedEdges = insideHits.length > 0 ? insideHits : clipHits;

    const edgeIndices = selectedEdges.map(e => e.edge.id);
    return edgeIndices;
  }

  getBoxSelectedFaceIds() {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;

    const faceMesh = this.sceneManager.sceneHelpers.getObjectByName('__FacePolygons');
    if (!faceMesh) return null;

    const faceHits = this.selectionBox.getFacesInFrustum(faceMesh, frustum);
    if (faceHits.length === 0) return null;

    const xrayMode = this.sceneManager.xrayMode;
    const visibleFaces = xrayMode ? faceHits : this.filterVisibleFaces(faceHits, faceMesh, this.camera);
    if (visibleFaces.length === 0) return null;

    const faceIndices = visibleFaces.map(f => f.index);
    return faceIndices;
  }

  selectVertices(vertexIds, isBoxSelection = false) {
    const isArray = Array.isArray(vertexIds);
    if (!isArray) vertexIds = [vertexIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        vertexIds.forEach(id => this.selectedVertexIds.add(id));
      } else {
        // Click selection: toggle
        vertexIds.forEach(id => {
          if (this.selectedVertexIds.has(id)) {
            this.selectedVertexIds.delete(id);
          } else {
            this.selectedVertexIds.add(id);
          }
        });
      }
    } else {
      this.selectedVertexIds.clear();
      vertexIds.forEach(id => this.selectedVertexIds.add(id));
    }

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch('vertex');
  }

  selectEdges(edgeIds, isBoxSelection = false) {
    const isArray = Array.isArray(edgeIds);
    if (!isArray) edgeIds = [edgeIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        edgeIds.forEach(id => this.selectedEdgeIds.add(id));
      } else {
        // Click selection: toggle
        edgeIds.forEach(id => {
          if (this.selectedEdgeIds.has(id)) {
            this.selectedEdgeIds.delete(id);
          } else {
            this.selectedEdgeIds.add(id);
          }
        });
      }
    } else {
      this.selectedEdgeIds.clear();
      edgeIds.forEach(id => this.selectedEdgeIds.add(id));
    }

    const vIds = this.getSelectedEdgeVertexIds();
    this.selectedVertexIds.clear();
    vIds.forEach(id => this.selectedVertexIds.add(id));

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch('edge');
  }

  selectFaces(faceIds, isBoxSelection = false) {
    const isArray = Array.isArray(faceIds);
    if (!isArray) faceIds = [faceIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        faceIds.forEach(id => this.selectedFaceIds.add(id));
      } else {
        // Click selection: toggle
        faceIds.forEach(id => {
          if (this.selectedFaceIds.has(id)) {
            this.selectedFaceIds.delete(id);
          } else {
            this.selectedFaceIds.add(id);
          }
        });
      }
    } else {
      this.selectedFaceIds.clear();
      faceIds.forEach(id => this.selectedFaceIds.add(id));
    }

    const vIds = this.getSelectedFaceVertexIds();
    this.selectedVertexIds.clear();
    vIds.forEach(id => this.selectedVertexIds.add(id));

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch('face');
  }

  clearSelection() {
    this.selectedVertexIds.clear();
    this.selectedEdgeIds.clear();
    this.selectedFaceIds.clear();
    this.vertexHandle.visible = false;
    this.dragging = false;
    this.mouseDownPos = null;

    this.signals.editSelectionCleared.dispatch();
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

  filterVisibleEdges(edgeCandidates, camera) {
    if (edgeCandidates.length === 0) return [];

    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const epsilon = 0.001;
    const reverseRay = new THREE.Raycaster();

    // occluders: everything in the scene except the edge helper lines
    const occluders = mainObjects.filter(obj => obj.name !== '__EdgeLines');

    const visibleEdges = [];

    for (const edge of edgeCandidates) {
      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, edge.hitPoint).normalize();
      const rayOrigin = (edge.hitPoint).clone().addScaledVector(dirToCamera, epsilon);

      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = (edge.hitPoint).distanceTo(cameraPos);

      // If any hit is closer than the camera, the edge is occluded.
      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        visibleEdges.push(edge);
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

      const blocked = hits.some(h => {
        //  Skip self-face intersection
        if (h.object === this.editedObject) {
          const hitFaceId = this.findFaceIdFromTriIndex(h.faceIndex, faceMesh.userData.faceRanges);
          if (hitFaceId === hit.faceIndex) return false;
        }

        return h.distance < maxDist - epsilon;
      });

      if (!blocked) {
        visibleFaces.push(hit);
      }
    }

    return visibleFaces;
  }

  buildEdgeCandidates(edgeHits) {
    const edges = [];

    for (const hit of edgeHits) {
      const thinLine = hit.object;
      const geo = thinLine.geometry;
      const pos = geo.getAttribute('position');

      if (!pos || pos.count < 2) continue;

      // world-space endpoints
      const vA = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0))
        .applyMatrix4(thinLine.matrixWorld);

      const vB = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1))
        .applyMatrix4(thinLine.matrixWorld);

      edges.push({
        thinLine,
        visualLine: thinLine.userData.visualLine,
        edge: thinLine.userData.edge,
        vA,
        vB,
        screenDist: hit.distance,
        hitPoint: hit.point,
        type: hit.type,
      });
    }

    return edges;
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
    if (!this.editedObject) return;
    
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
    if (!this.editedObject) return;

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