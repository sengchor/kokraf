import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LoopCutOps } from '../operations/LoopCutOps.js';

export class LoopCutTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.scene = editor.sceneManager.sceneEditorHelpers;
    this.editSelection = editor.editSelection;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.ops = new LoopCutOps(editor);

    this.active = false;
    this.previewLines = [];
    this.previewMaterial = null;

    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onMouseWheel = this.onMouseWheel.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  // Read-only accessor (UI)
  get cutCount() {
    return this.ops.cutCount;
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this._onMouseWheel, { passive: false, capture: true });
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.clearPreview();
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.raycaster.camera = camera;
      }
    });
  }

  // Pointer input
  onPointerDown(event) {
    if (event.button !== 0 || !this.active) return;

    const object = this.editSelection.editedObject;
    const loopEdges = this.pickLoop(event, object);
    if (!loopEdges) return;

    this.ops.cut(object, loopEdges);
    this.clearPreview();
  }

  onPointerMove(event) {
    if (!this.active) return;

    const object = this.editSelection.editedObject;
    const loopEdges = this.pickLoop(event, object);

    if (loopEdges) this.showPreview(object, loopEdges);
    else this.clearPreview();
  }

  onMouseWheel(event) {
    if (!this.active) return;

    const object = this.editSelection.editedObject;
    const loopEdges = this.pickLoop(event, object);
    if (!loopEdges) {
      this.clearPreview();
      return; // let the wheel zoom when not over a loop
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    this.ops.setCutCount(this.ops.cutCount + (event.deltaY < 0 ? 1 : -1));
    this.showPreview(object, loopEdges);
  }

  onPointerUp() {
    if (!this.active) return;

    requestAnimationFrame(() => {
      this.signals.onToolEnded.dispatch();
    });
  }

  onKeyDown(event) {
    if (!this.active) return;

    if (event.key === 'Escape') {
      this.signals.onToolEnded.dispatch();
    }
  }

  // Picking
  pickLoop(event, object) {
    if (!object?.userData?.meshData) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(object, false);
    if (intersects.length === 0) return null;

    return LoopCutOps.findLoopFromIntersect(
      object.userData.meshData,
      object.userData.renderBuffer,
      object.matrixWorld,
      intersects[0]
    );
  }

  // Preview
  getPreviewMaterial() {
    if (!this.previewMaterial) {
      this.previewMaterial = new LineMaterial({
        color: 0xffff00,
        linewidth: 1,
        transparent: false,
        opacity: 0.9,
        depthTest: false,
      });
    }

    const canvas = this.renderer.domElement;
    this.previewMaterial.resolution.set(canvas.clientWidth, canvas.clientHeight);
    return this.previewMaterial;
  }

  showPreview(object, loopEdges) {
    this.clearPreview();

    const material = this.getPreviewMaterial();
    const polylines = LoopCutOps.computePreviewPolylines(
      object.userData.meshData,
      object.matrixWorld,
      loopEdges,
      this.ops.cutCount
    );

    for (const points of polylines) {
      const geometry = new LineGeometry();
      geometry.setPositions(points);

      const line = new Line2(geometry, material);
      line.computeLineDistances();

      this.scene.add(line);
      this.previewLines.push(line);
    }
  }

  clearPreview() {
    for (const line of this.previewLines) {
      this.scene.remove(line);
      line.geometry.dispose();
    }

    this.previewLines = [];
  }
}