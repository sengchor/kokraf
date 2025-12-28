import * as THREE from 'three';

export class SnapManager {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.enabled = false;
    this.snapMode = 'vertex';
    this.thresholdPx = 20;

    this.raycaster.params = {
      Points: { threshold: 10 },
      Line:   { threshold: 10 },
    };

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

  snapObjectPosition(event, selectedObjects) {
    return this._snap(event, { targetObjects: selectedObjects });
  }

  snapEditPosition(event, selectedVertexIds, editedObject) {
    return this._snap(event, { selectedVertexIds, editedObject });
  }

  _snap(event, { selectedVertexIds = [], editedObject = null, targetObjects = null }) {
    if (!this.enabled || !event) {
      this.updateSnapPreview(null);
      return null;
    }

    let result = null;

    switch (this.snapMode) {
      case 'vertex':
        result = this.snapVertex(event, selectedVertexIds, editedObject, targetObjects);
        break;
      case 'edge':
        result = this.snapEdge(event, selectedVertexIds, editedObject, targetObjects);
        break;
      case 'face':
        result = this.snapFace(event, selectedVertexIds, editedObject, targetObjects);
        break;
    }

    this.updateSnapPreview(result);
    return result;
  }

  snapVertex(event, selectedVertexIds, editedObject, ignoreObjects) {
    if (!this.enabled) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const ignoreSet = new Set(ignoreObjects);

    const hits = this.raycaster.intersectObjects(this.sceneManager.mainScene.children, true);
    if (hits.length === 0) return null;

    let closest = null;
    let minDistSq = this.thresholdPx * this.thresholdPx;

    for (const hit of hits) {
      const obj = hit.object;
      if (!obj.isMesh || !obj.geometry?.attributes?.position) continue;
      if (ignoreSet.has(obj)) continue;

      const posAttr = obj.geometry.attributes.position;
      const meshData = obj.userData.meshData;

      const local = new THREE.Vector3();
      const world = new THREE.Vector3();
      const screenPos = new THREE.Vector3();

      for (let bufferIndex = 0; bufferIndex < posAttr.count; bufferIndex++) {
        if (obj === editedObject && meshData) {
          const vertexId = meshData.bufferIndexToVertexId.get(bufferIndex);
          if (vertexId !== undefined && selectedVertexIds.includes(vertexId)) continue;
        }

        local.fromBufferAttribute(posAttr, bufferIndex);
        world.copy(local).applyMatrix4(obj.matrixWorld);

        screenPos.copy(world).project(this.camera);
        const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
        const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;

        const dx = sx - event.clientX;
        const dy = sy - event.clientY;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
          minDistSq = distSq;
          closest = world.clone();
        }
      }
    }

    return closest;
  }

  snapEdge(event, selectedVertexIds, editedObject, ignoreObjects) {
    if (!this.enabled) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const ignoreSet = new Set(ignoreObjects);

    const hits = this.raycaster.intersectObjects(this.sceneManager.mainScene.children, true);
    if (hits.length === 0) return null;

    let closest = null;
    let minDistSq = this.thresholdPx * this.thresholdPx;

    for (const hit of hits) {
      const obj = hit.object;
      if (!obj.isMesh || !obj.userData.meshData) continue;
      if (ignoreSet.has(obj)) continue;

      const meshData = obj.userData.meshData;
      const worldMatrix = obj.matrixWorld;

      const vAWorld = new THREE.Vector3();
      const vBWorld = new THREE.Vector3();
      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const snapWorld = new THREE.Vector3();

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

        const { t, cx, cy } = this.getClosestPointOnScreenSegment(event.clientX, event.clientY, 
          ax, ay, bx, by);

        const dx = cx - event.clientX;
        const dy = cy - event.clientY;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
          minDistSq = distSq;

          snapWorld.copy(vBWorld).sub(vAWorld).multiplyScalar(t).add(vAWorld);

          closest = snapWorld.clone();
        }
      }
    }

    return closest;
  }

  snapFace(event, selectedVertexIds, editedObject, ignoreObjects) {
    if (!this.enabled) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const ignoreSet = new Set(ignoreObjects);

    const hits = this.raycaster.intersectObjects(this.sceneManager.mainScene.children, true);

    for (const hit of hits) {
      const obj = hit.object;
      if (!obj.isMesh) continue;
      if (ignoreSet.has(obj)) continue;

      const meshData = obj.userData.meshData;
      if (!meshData) continue;

      // Skip self-face with selected vertices
      if (obj === editedObject) {
        const face = this.getMeshDataFaceFromTriangle(meshData, obj.geometry, hit.faceIndex);

        if (face) {
          const hasSelectedVertex = face.vertexIds.some(id =>selectedVertexIds.includes(id));

          if (hasSelectedVertex) continue;
        }
      }

      return hit.point.clone();
    }

    return null;
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

  getBoundingBoxVertexPositions(objects) {
    const positions = [];
    const localBox = new THREE.Box3();
    const min = new THREE.Vector3();
    const max = new THREE.Vector3();

    for (const obj of objects) {
      if (!obj.isMesh || !obj.geometry) continue;

      obj.updateMatrixWorld(true);

      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }

      localBox.copy(obj.geometry.boundingBox);
      min.copy(localBox.min);
      max.copy(localBox.max);

      const localCorners = [
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(min.x, max.y, min.z),
        new THREE.Vector3(max.x, max.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z),
        new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(min.x, max.y, max.z),
        new THREE.Vector3(max.x, max.y, max.z),
      ];

      for (const v of localCorners) {
        positions.push(v.applyMatrix4(obj.matrixWorld));
      }
    }

    return positions;
  }

  getMeshDataFaceFromTriangle(meshData, geometry, faceIndex) {
    const index = geometry.index;
    if (!index) return null;

    const i0 = index.getX(faceIndex * 3);
    const i1 = index.getX(faceIndex * 3 + 1);
    const i2 = index.getX(faceIndex * 3 + 2);

    const vId0 = meshData.bufferIndexToVertexId.get(i0);
    const vId1 = meshData.bufferIndexToVertexId.get(i1);
    const vId2 = meshData.bufferIndexToVertexId.get(i2);

    if (vId0 === undefined || vId1 === undefined || vId2 === undefined) {
      return null;
    }

    for (const face of meshData.faces.values()) {
      const ids = face.vertexIds;
      if (
        ids.includes(vId0) &&
        ids.includes(vId1) &&
        ids.includes(vId2)
      ) {
        return face;
      }
    }

    return null;
  }

  constrainTranslationOffset(offsetWorld, axis, orientation, object) {
    if (orientation === "world") {
      return this.constrainTranslationOffsetWorld(offsetWorld, axis);
    } else {
      return this.constrainTranslationOffsetLocal(offsetWorld, axis, object);
    }
  }

  constrainTranslationOffsetWorld(offset, axis) {
    const result = offset.clone();

    switch (axis) {
      case 'X':  result.y = 0; result.z = 0; break;
      case 'Y':  result.x = 0; result.z = 0; break;
      case 'Z':  result.x = 0; result.y = 0; break;
      case 'XY': result.z = 0; break;
      case 'XZ': result.y = 0; break;
      case 'YZ': result.x = 0; break;
      case 'XYZ':
      default:
        break;
    }

    return result;
  }

  constrainTranslationOffsetLocal(offset, axis, object) {
    const worldQuat = object.getWorldQuaternion(new THREE.Quaternion());
    const invWorldQuat = worldQuat.clone().invert();

    const localOffset = offset.clone().applyQuaternion(invWorldQuat);
    const constrainedLocal = this.constrainTranslationOffsetWorld(localOffset, axis);

    return constrainedLocal.applyQuaternion(worldQuat);
  }

  projectOntoTransformAxis(offset, axis, orientation, object) {
    const worldQuat = object.getWorldQuaternion(new THREE.Quaternion());
    const invWorldQuat = worldQuat.clone().invert();

    const localOffset = offset.clone().applyQuaternion(invWorldQuat);

    const activeAxis = axis.toLowerCase();
    const mask = new THREE.Vector3(
        activeAxis.includes('x') ? 1 : 0,
        activeAxis.includes('y') ? 1 : 0,
        activeAxis.includes('z') ? 1 : 0
    );

    if (orientation === 'world') {
      mask.applyQuaternion(invWorldQuat);
    }

    return localOffset.clone().multiply(mask);
  }

  getEffectiveRotationAxis(axis, orientation, pivotQuaternion) {
    const baseAxis = this.getRotationAxis(axis);
    if (!baseAxis) return null;

    if (orientation === 'world') {
      return baseAxis.clone();
    } else {
      return baseAxis.clone().applyQuaternion(pivotQuaternion).normalize();
    }
  }

  getRotationAxis(axis) {
    if (!axis || axis === 'XYZ') return null;

    switch (axis) {
      case 'X': return new THREE.Vector3(1, 0, 0);
      case 'Y': return new THREE.Vector3(0, 1, 0);
      case 'Z': return new THREE.Vector3(0, 0, 1);
      default: return null;
    }
  }

  makeScaleVectorFromAxis(scale, axis) {
    const result = new THREE.Vector3(1, 1, 1);

    switch (axis) {
      case 'X':
        result.set(scale, 1, 1);
        break;
      case 'Y':
        result.set(1, scale, 1);
        break;
      case 'Z':
        result.set(1, 1, scale);
        break;
      case 'XY':
        result.set(scale, scale, 1);
        break;
      case 'XZ':
        result.set(scale, 1, scale);
        break;
      case 'YZ':
        result.set(1, scale, scale);
        break;
      case 'XYZ':
      default:
        result.set(scale, scale, scale);
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