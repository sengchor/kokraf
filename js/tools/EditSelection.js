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
  }

  onMouseSelect(event, renderer, camera) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // raycast in helper scene to find candidate vertices
    this.raycaster.setFromCamera(this.mouse, camera);
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    this.raycaster.params.Points.threshold = 0.15;
    const vertexHits = this.raycaster.intersectObject(vertexPoints);
    if (vertexHits.length === 0) return this.clearSelection();

    // reverse ray trace for occlusion
    const frontVertices = this.filterVisibleVertices(vertexHits, vertexPoints, camera);
    if (frontVertices.length === 0) return this.clearSelection();

    // choose nearest visible vertex in 2D to the click
    const bestHit = this.pickNearestVertex(frontVertices, camera, rect, vertexPoints);
    if (!bestHit) return this.clearSelection();

    this.highlightSelectedVertex(bestHit.logicalVertexId);
    this.getSelectedFacesFromVertices(this.selectedVertexIds);
    this.moveVertexHandle(vertexPoints);
  }

  highlightSelectedVertex(vertexId) {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const ids = vertexPoints.geometry.getAttribute('vertexId');

    if (this.multiSelectEnabled) {
      if (this.selectedVertexIds.has(vertexId)) {
        this.selectedVertexIds.delete(vertexId);
      } else {
        this.selectedVertexIds.add(vertexId);
      }
    } else {
      this.selectedVertexIds.clear();
      this.selectedVertexIds.add(vertexId);
    }

    for (let i = 0; i < ids.count; i++) {
      if (this.selectedVertexIds.has(ids.getX(i))) {
        colors.setXYZ(i, 1, 1, 1);
      } else {
        colors.setXYZ(i, 0, 0, 0);
      }
    }

    colors.needsUpdate = true;

    this.highlightSelectedEdges();
  }

  highlightSelectedVertices() {
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

    this.highlightSelectedEdges();
  }

  highlightSelectedEdges() {
    const edges = [];
    this.sceneManager.sceneHelpers.traverse(obj => {
      if (obj.name === '__EdgeLines' && obj.userData.edge) {
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
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    this.clearSelection();

    for (let id of vertexIds) {
      this.selectedVertexIds.add(id);
    }

    this.highlightSelectedVertices();
    this.getSelectedFacesFromVertices(this.selectedVertexIds);

    if (vertexIds.length > 0) {
      this.vertexHandle.visible = true;
      this.vertexHandle.userData.vertexIndices = vertexIds;
    } else {
      this.vertexHandle.visible = false;
      this.vertexHandle.userData.vertexIndices = [];
    }

    this.moveVertexHandle(vertexPoints);
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
      if (obj.name === '__EdgeLines' && obj.userData.edge) {
        const material = obj.material;
        material.color.set(0x000000);
        material.needsUpdate = true;
      }
    });

    this.selectedVertexIds.clear();
    this.vertexHandle.visible = false;
  }

  moveVertexHandle(vertexPoints) {
    if (!this.vertexHandle) return;

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const ids = vertexPoints.geometry.getAttribute('vertexId');

    const worldPos = new THREE.Vector3();
    const sum = new THREE.Vector3();
    let count = 0;
    const selectedIndices = [];

    for (let i = 0; i < ids.count; i++) {
      const vId = ids.getX(i);
      if (this.selectedVertexIds.has(vId)) {
        const localPos = new THREE.Vector3(
          posAttr.getX(i),
          posAttr.getY(i),
          posAttr.getZ(i)
        );
        worldPos.copy(localPos).applyMatrix4(this.editedObject.matrixWorld);
        sum.add(worldPos);
        count++;
        selectedIndices.push(vId);
      }
    }
    
    if (count > 0) {
      sum.divideScalar(count);
      this.vertexHandle.position.copy(sum);
      this.vertexHandle.visible = true;
      this.vertexHandle.userData.vertexIndices = selectedIndices;
    } else {
      this.vertexHandle.visible = false;
      this.vertexHandle.userData.vertexIndices = [];
    }
  }

  filterVisibleVertices(vertexHits, vertexPoints, camera) {
    const mainObjects = this.sceneManager.mainScene.children;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);

    const reverseRay = new THREE.Raycaster();
    const frontVertices = [];

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const epsilon = 0.001;
    const occluders = mainObjects.filter(obj => obj !== vertexPoints);

    for (const vh of vertexHits) {
      const vertexPos = new THREE.Vector3(
        posAttr.getX(vh.index),
        posAttr.getY(vh.index),
        posAttr.getZ(vh.index)
      ).applyMatrix4(vertexPoints.matrixWorld);

      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, vertexPos).normalize();
      const rayOrigin = vertexPos.clone().add(dirToCamera.clone().multiplyScalar(epsilon));
      reverseRay.set(rayOrigin, dirToCamera);

      const hits = reverseRay.intersectObjects(occluders, true);
      const maxDist = vertexPos.distanceTo(cameraPos);
      const blocked = hits.some(h => h.distance < maxDist - epsilon);

      if (!blocked) {
        frontVertices.push({ ...vh, point: vertexPos });
      }
    }

    if (frontVertices.length === 0) {
      this.clearSelection();
      return frontVertices;
    }
    return frontVertices;
  }

  pickNearestVertex(frontVertices, camera, rect, vertexPoints) {
    let bestHit = null;
    let minScreenDistSq = Infinity;

    const vertexIdAttr = vertexPoints.geometry.getAttribute('vertexId');

    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;

    const screenPos = new THREE.Vector3();
    frontVertices.forEach(hit => {
      screenPos.copy(hit.point).project(camera);
      const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
      const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;

      const dx = sx - clickX;
      const dy = sy - clickY;
      const distPxSq = dx * dx + dy * dy;

      if (distPxSq < minScreenDistSq) {
        minScreenDistSq = distPxSq;
        bestHit = {
          pointIndex: hit.index,
          logicalVertexId: vertexIdAttr.getX(hit.index)
        };
      }
    });
    return bestHit;
  }
}