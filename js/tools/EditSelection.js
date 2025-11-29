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

    const edges = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLines' && obj.userData.edge) {
        edges.push(obj);
      }
    });

    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Line.threshold = threshold;
    
    const edgeHits = this.raycaster.intersectObjects(edges, false);
    if (edgeHits.length === 0) return null;

    const visibleEdges = this.filterVisibleEdges(edgeHits, camera);
    if (visibleEdges.length === 0) return null;

    const nearestEdgeId = this.pickNearestEdge(visibleEdges, camera, rect);

    return nearestEdgeId;
  }

  highlightSelectedVertex() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const ids = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < ids.count; i++) {
      if (this.selectedVertexIds.has(ids.getX(i))) {
        colors.setXYZ(i, 1, 1, 1);
      } else {
        colors.setXYZ(i, 0, 0, 0);
      }
    }

    colors.needsUpdate = true;

    this.highlightEdgesFromVertices();
  }

  highlightSelectedEdge() {
    const edges = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLinesVisual' && obj.userData.edge) {
        edges.push(obj);
      }
    });

    for (let edgeLine of edges) {
      const { edge } = edgeLine.userData;
      const material = edgeLine.material;

      if (this.selectedEdgeIds.has(edge.id)) {
        material.color.set(0xffffff);
      } else {
        material.color.set(0x000000);
      }

      material.needsUpdate = true;
    }
  }

  highlightEdgesFromVertices() {
    const edges = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLinesVisual' && obj.userData.edge) {
        edges.push(obj);
      }
    });

    this.selectedEdgeIds.clear();

    for (let edgeLine of edges) {
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
    this.getSelectedFacesFromVertices(this.selectedVertexIds);
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
    this.getSelectedFacesFromEdges(this.selectedEdgeIds);
    this.updateVertexHandle();
  }

  getSelectedFacesFromVertices(vertexIds) {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return [];

    const selectedVertexSet = new Set(vertexIds);
    const selectedFaces = [];

    for (let face of meshData.faces.values()) {
      const allVertsSelected = face.vertexIds.every(vid => selectedVertexSet.has(vid));
      if (allVertsSelected) {
        selectedFaces.push(face.id);
      }
    }

    // Update internal selectedFaceIds set
    this.selectedFaceIds.clear();
    selectedFaces.forEach(fid => this.selectedFaceIds.add(fid));

    return selectedFaces;
  }

  getSelectedFacesFromEdges(edgeIds) {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return [];

    const selectedEdgeSet = new Set(edgeIds);
    const selectedFaces = [];

    for (let face of meshData.faces.values()) {
      // Check if all edges of the face are selected
      const allEdgesSelected = [...face.edgeIds].every(eid => selectedEdgeSet.has(eid));
      if (allEdgesSelected) {
        selectedFaces.push(face.id);
      }
    }

    // Update internal selectedFaceIds set
    this.selectedFaceIds.clear();
    selectedFaces.forEach(fid => this.selectedFaceIds.add(fid));

    return selectedFaces;
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

    this.selectedVertexIds.clear();
    this.selectedEdgeIds.clear();
    this.vertexHandle.visible = false;
  }

  updateVertexHandle() {
    if (!this.vertexHandle || !this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    let vertexIds = [];
    let edgeIds = [];

    if (this.subSelectionMode === 'vertex') {
      vertexIds = this.getSelectedVertexIds();
      edgeIds = [];
    } else if (this.subSelectionMode === 'edge') {
      vertexIds = this.getSelectedEdgeVertexIds();
      edgeIds = Array.from(this.selectedEdgeIds);
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

  filterVisibleVertices(vertices, vertexPoints, camera) {
    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const reverseRay = new THREE.Raycaster();
    const visibleVertices = [];

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const epsilon = 0.001;
    const occluders = mainObjects.filter(obj => obj !== vertexPoints);

    for (const vertex of vertices) {
      const vertexPos = new THREE.Vector3(
        posAttr.getX(vertex.index),
        posAttr.getY(vertex.index),
        posAttr.getZ(vertex.index)
      ).applyMatrix4(vertexPoints.matrixWorld);

      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, vertexPos).normalize();
      const rayOrigin = vertexPos.clone().add(dirToCamera.clone().multiplyScalar(epsilon));
      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = vertexPos.distanceTo(cameraPos);
      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        visibleVertices.push({ ...vertex, point: vertexPos });
      }
    }

    return visibleVertices;
  }

  filterVisibleEdges(edges, camera) {
    if (edges.length === 0) return [];

    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const epsilon = 0.001;
    const reverseRay = new THREE.Raycaster();
    const visibleEdges = [];

    // occluders: everything in the scene except the edge helper lines
    const occluders = mainObjects.filter(obj => obj.name !== '__EdgeLines');

    for (const edge of edges) {
      const thinLine = edge.object;
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
          screenDist: edge.distance,
        });
      }
    }

    return visibleEdges;
  }

  pickNearestVertex(vertices, camera, rect, vertexPoints) {
    let nearestVertexId = null;
    let minScreenDistSq = Infinity;

    const vertexIdAttr = vertexPoints.geometry.getAttribute('vertexId');

    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const screenPos = new THREE.Vector3();
    vertices.forEach(hit => {
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

  pickNearestEdge(edges, camera, rect) {
    if (!edges || edges.length === 0) return null;

    let nearestEdgeId = null;
    let minDistSq = Infinity;

    edges.forEach(edge => {
      const result = this.getClosestPointOnScreenLine(edge, camera, rect);

      if (result.distSq < minDistSq) {
        minDistSq = result.distSq;
        nearestEdgeId = result.edgeId;
      }
    });

    return nearestEdgeId;
  }

  getClosestPointOnScreenLine(edge, camera, rect) {
    // Mouse in pixel coordinates
    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();

    // Project both endpoints to NDC → screen
    pA.copy(edge.vA).project(camera);
    pB.copy(edge.vB).project(camera);

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
      edgeId: edge.edge.id
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
}