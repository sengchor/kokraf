import * as THREE from 'three';
import { getManifoldWasm, toManifold, fromManifoldResult } from '../geometry/MeshDataManifold.js';
import { RemoveObjectCommand } from '../commands/RemoveObjectCommand.js';
import { DifferenceCommand } from '../commands/DifferenceCommand.js';
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';

export class DifferenceTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.renderer = editor.renderer;
    this.selection = editor.selection;
    this.vertexEditor = editor.vertexEditor;

    this._state = 'idle';
    this._firstObject = null;
    this._secondObject = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = editor.cameraManager.camera;

    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  enable() {
    this._state = 'pick_first';
    this._firstObject = null;
    this._secondObject = null;

    // Hand off from normal selection
    this.selection.deselect();
    this.selection.enable = false;

    this.renderer.domElement.addEventListener('mousedown', this._onPointerDown);
    window.addEventListener('keydown', this._onKeyDown);

    this.signals.onToolStarted.dispatch('Select first object');
  }

  disable() {
    if (this._state !== 'idle') {
      this.cancelDifferenceSession();

      this._state = 'idle';
      this._firstObject = null;
      this._secondObject = null;

      this.renderer.domElement.removeEventListener('mousedown', this._onPointerDown);
      window.removeEventListener('keydown', this._onKeyDown);
    }
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
      }
    });
  }

  onPointerDown(event) {
    if (event.button !== 0) return;

    const hit = this.pick(event);
    
    if (this._state === 'pick_first') {
      if (!hit) return;

      this._firstObject = hit;
      this.selection.highlightObject(hit);

      this._state = 'pick_second';
      this.signals.onToolUpdated.dispatch('Select second object');
    } else if (this._state === 'pick_second') {
      if (!hit || hit === this._firstObject) return;

      this._secondObject = hit;
      this.selection.highlightObject(hit);
      
      this._state= 'confirm';
      this.signals.onToolUpdated.dispatch('Press Enter to difference, Escape to cancel');
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      this.cancelDifferenceSession();

      this._state = 'idle';
      this._firstObject = null;
      this._secondObject = null;
      return;
    }

    if (event.key === 'Enter' && this._state === 'confirm') {
      this.executeDifference();
    }
  }

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objects = this.selection.getPickableObjects().filter(
      obj => obj.isMesh && obj.userData?.meshData
    );

    const hits = this.raycaster.intersectObjects(objects, false);
    if (hits.length === 0) return null;

    const hit = hits[0].object;
    return hit;
  }

  clearPicks() {
    if (this._firstObject) this.selection.unhighlightObject(this._firstObject);
    if (this._secondObject) this.selection.unhighlightObject(this._secondObject);
  }

  cancelDifferenceSession() {
    this.clearPicks();
    this.selection.enable = true;

    this.signals.onToolEnded.dispatch();
  }

  async executeDifference() {
    const primary = this._firstObject;
    const secondary = this._secondObject;

    if (!primary?.userData?.meshData || !secondary?.userData?.meshData) {
      this.cancelDifferenceSession();
      return;
    }

    const meshData = primary.userData.meshData;
    const beforeMeshData = structuredClone(meshData);

    const idOffsetB = primary.userData.meshData.nextFaceId + meshData.vertices.size;

    try {
      await getManifoldWasm();

      const [
        { manifold: manifoldA, faceIdMap: faceIdMapA },
        { manifold: manifoldB, faceIdMap: faceIdMapB }
      ] = await Promise.all([
        toManifold(primary, 0),
        toManifold(secondary, idOffsetB),
      ]);

      const result = manifoldA.subtract(manifoldB);
      const resultMesh = result.getMesh();

      this.clearPicks();

      const resultMeshData = fromManifoldResult(resultMesh, faceIdMapA, faceIdMapB, primary);

      const multi = new SequentialMultiCommand(this.editor, 'Difference Objects');
      multi.add(() => new DifferenceCommand(this.editor, primary, beforeMeshData, resultMeshData));
      multi.add(() => new RemoveObjectCommand(this.editor, secondary));
      this.editor.execute(multi);
    } catch (err) {
      console.error('DifferenceTool failed:', err);

      this.cancelDifferenceSession();
      return;
    }

    this.cancelDifferenceSession();
  }
}