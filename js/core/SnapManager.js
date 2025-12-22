import * as THREE from 'three';

export class SnapManager {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.enabled = false;
    this.snapMode = 'vertex';
    this.thresholdPx = 10;

    this.createSnapPreview();
    this.setupListeners();
  }

  setupListeners() {
    this.signals.transformDragEnded.add(() => {
      this.updateSnapPreview(null);
    });
  }

  setEnabled(state) {
    this.enabled = state;
  }

  setSnapMode(mode) {
    this.snapMode = mode;
  }

  snapPosition(event, selectedVertexIds, editedObject) {
    if (!this.enabled || !event) {
      this.updateSnapPreview(null);
      return null;
    }

    let result = null;

    switch (this.snapMode) {
      case 'vertex':
        result = this.snapVertex(event, selectedVertexIds, editedObject);
        break;
      case 'edge':
        result = this.snapEdge(event, selectedVertexIds, editedObject);
        break;
    }

    this.updateSnapPreview(result);
    return result;
  }

  snapVertex(event, selectedVertexIds, editedObject) {
    if (!this.enabled) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    let closest = null;
    let minDistSq = this.thresholdPx * this.thresholdPx;

    const local = new THREE.Vector3();
    const world = new THREE.Vector3();
    const screenPos = new THREE.Vector3();

    this.sceneManager.mainScene.traverse(obj => {
      if (!obj.isMesh || !obj.geometry) return;

      const posAttr = obj.geometry.attributes.position;
      if (!posAttr) return;

      const isEditedObject = obj === editedObject;
      const meshData = isEditedObject ? obj.userData.meshData : null;

      for (let bufferIndex = 0; bufferIndex < posAttr.count; bufferIndex++) {
        if (isEditedObject && meshData) {
          const vertexId = meshData.bufferIndexToVertexId.get(bufferIndex);
          if (vertexId !== undefined && selectedVertexIds.includes(vertexId)) continue;
        }

        local.fromBufferAttribute(posAttr, bufferIndex);
        world.copy(local).applyMatrix4(obj.matrixWorld);

        screenPos.copy(world).project(this.camera);
        const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
        const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;

        const dx = sx - mouseX;
        const dy = sy - mouseY;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
          minDistSq = distSq;
          closest = world.clone();
        }
      }
    });

    return closest;
  }

  snapEdge(event, selectedVertexIds, editedObject) {
    if (!this.enabled) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    let closest = null;
    let minDistSq = this.thresholdPx * this.thresholdPx;

    const vAWorld = new THREE.Vector3();
    const vBWorld = new THREE.Vector3();
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const snapWorld = new THREE.Vector3();

    this.sceneManager.mainScene.traverse(obj => {
      if (!obj.isMesh || !obj.geometry) return;

      const meshData = obj.userData.meshData;
      const worldMatrix = obj.matrixWorld;

      for (const edge of meshData.edges.values()) {
        if (
          obj === editedObject &&
          (selectedVertexIds.includes(edge.v1Id) ||
          selectedVertexIds.includes(edge.v2Id))
        ) continue;

        const v1 = meshData.vertices.get(edge.v1Id);
        const v2 = meshData.vertices.get(edge.v2Id);
        if (!v1 || !v2) continue;

        vAWorld.copy(v1.position).applyMatrix4(worldMatrix);
        vBWorld.copy(v2.position).applyMatrix4(worldMatrix);

        pA.copy(vAWorld).project(this.camera);
        pB.copy(vBWorld).project(this.camera);

        const ax = (pA.x * 0.5 + 0.5) * rect.width;
        const ay = (-pA.y * 0.5 + 0.5) * rect.height;
        const bx = (pB.x * 0.5 + 0.5) * rect.width;
        const by = (-pB.y * 0.5 + 0.5) * rect.height;

        const { t, cx, cy } = this.getClosestPointOnScreenSegment(mouseX, mouseY, ax, ay, bx, by);

        const dx = cx - mouseX;
        const dy = cy - mouseY;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
          minDistSq = distSq;

          snapWorld.copy(vBWorld).sub(vAWorld).multiplyScalar(t).add(vAWorld);

          closest = snapWorld.clone();
        }
      }
    });

    return closest;
  }

  getClosestPointOnScreenSegment(px, py, ax, ay, bx, by) {
    const ABx = bx - ax;
    const ABy = by - ay;
    const APx = px - ax;
    const APy = py - ay;

    const abLenSq = ABx * ABx + ABy * ABy;

    let t = 0;
    if (abLenSq > 0) {
      t = (APx * ABx + APy * ABy) / abLenSq;
    }

    t = Math.max(0, Math.min(1, t));

    return {
      t,
      cx: ax + ABx * t,
      cy: ay + ABy * t
    };
  }

  getNearestPositionToPoint(positions, worldPoint) {
    if (!positions || positions.length === 0) return null;

    let nearest = null;
    let minDistSq = Infinity;

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const distSq = pos.distanceToSquared(worldPoint);

      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = pos;
      }
    }

    return nearest ? nearest.clone() : null;
  }

  applyTranslationAxisConstraint(offset, axis) {
    const result = offset.clone();

    switch (axis) {
      case 'X':
        result.y = 0;
        result.z = 0;
        break;
      case 'Y':
        result.x = 0;
        result.z = 0;
        break;
      case 'Z':
        result.x = 0;
        result.y = 0;
        break;
      case 'XY':
        result.z = 0;
        break;
      case 'XZ':
        result.y = 0;
        break;
      case 'YZ':
        result.x = 0;
        break;
      case 'XYZ':
        break;
      default:
        break;
    }

    return result;
  }

  createSnapPreview() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Draw circle
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 6;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    this.snapPreview = new THREE.Sprite(material);
    this.snapPreview.renderOrder = Infinity + 1;
    this.snapPreview.frustumCulled = false;
    this.snapPreview.visible = false;
    this.snapPreview.scale.set(1, 1, 1);

    this.sceneManager.sceneEditorHelpers.add(this.snapPreview);
  }

  updateSnapPreview(worldPosition) {
    if (!worldPosition) {
      this.snapPreview.visible = false;
      return;
    }

    this.snapPreview.visible = true;
    this.snapPreview.position.copy(worldPosition);

    const camera = this.camera;
    const distance = camera.position.distanceTo(worldPosition);

    const fov = camera.fov * (Math.PI / 180);
    const worldHeightAtDistance = 2 * Math.tan(fov / 2) * distance;

    const viewportHeight = this.renderer.domElement.clientHeight;

    const desiredPixelSize = 18;
    const scale = (desiredPixelSize / viewportHeight) * worldHeightAtDistance;

    this.snapPreview.scale.set(scale, scale, 1);
  }
}