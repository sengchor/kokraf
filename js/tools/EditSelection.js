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
    this.moveVertexHandle(vertexPoints, bestHit.pointIndex, bestHit.logicalVertexId);
  }

  highlightSelectedVertex(vertexId) {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const ids = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(i, 0, 0, 0);
    }

    for (let i = 0; i < ids.count; i++) {
      if (ids.getX(i) === vertexId) {
        colors.setXYZ(i, 1, 1, 1);
        break;
      }
    }

    colors.needsUpdate = true;
  }

  clearSelection() {
    const vertexPoints = this.sceneManager.sceneHelpers.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.attributes.color;
    const count = colors.count;

    for (let i = 0; i < count; i++) {
      colors.setXYZ(i, 0, 0, 0);
    }

    colors.needsUpdate = true;
    this.selectedVertexId = null;
    this.vertexHandle.visible = false;
  }

  moveVertexHandle(vertexPoints, pointIndex, logicalVertexId) {
    if (!this.vertexHandle) return;

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const localPos = new THREE.Vector3(
      posAttr.getX(pointIndex),
      posAttr.getY(pointIndex),
      posAttr.getZ(pointIndex)
    );

    const worldPos = localPos.clone().applyMatrix4(vertexPoints.matrixWorld);

    this.vertexHandle.position.copy(worldPos);
    this.vertexHandle.userData.vertexIndex = logicalVertexId;
    this.vertexHandle.visible = true;
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