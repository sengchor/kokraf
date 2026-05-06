import * as THREE from 'three';

export class UnionTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.renderer = editor.renderer;
    this.selection = editor.selection;

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
    this._state = 'idle';
    this._firstObject = null;
    this._secondObject = null;

    this.renderer.domElement.removeEventListener('mousedown', this._onPointerDown);
    window.removeEventListener('keydown', this._onKeyDown);
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
      this.signals.onToolUpdated.dispatch('Press Enter to union, Escape to cancel');
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      this.cancelUnionSession();

      this._state = 'idle';
      this._firstObject = null;
      this._secondObject = null;
    }

    if (event.key === 'Enter' && this._state === 'confirm') {
      console.log('Confirm');
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

  cancelUnionSession() {
    this.clearPicks();
    this.selection.enable = true;

    requestAnimationFrame(() => {
      this.signals.onToolEnded.dispatch();
    });
  }
}