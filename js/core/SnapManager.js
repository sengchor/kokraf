import * as THREE from 'three';

export class SnapManager {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.enabled = false;
    this.threshold = 0.15;
    this.thresholdPx = 10;
  }

  setEnabled(state) {
    this.enabled = state;
  }

  snapPosition(event, selectedVertexIds, editedObject) {
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
}