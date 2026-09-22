import * as THREE from 'three';
import { DifferenceOps } from '../operations/DifferenceOps.js';

// idle → pick_first → pick_second → confirm → running → idle
export class DifferenceTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.renderer = editor.renderer;
    this.selection = editor.selection;

    this.ops = new DifferenceOps(editor);

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
    this.selection.tool = true;

    this.renderer.domElement.addEventListener('mousedown', this._onPointerDown);
    window.addEventListener('keydown', this._onKeyDown);

    this.signals.onToolStarted.dispatch('Select first object');
  }

  disable() {
    if (this._state === 'idle') return;
    this.endSession();
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
      }
    });

    this.signals.toolSelectObject.add((object) => {
      this.selectObject(object);
    });
  }

  // Input
  onPointerDown(event) {
    if (event.button !== 0) return;
    this.selectObject(this.pick(event));
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      this.handleCancel();
      return;
    }

    if (event.key === 'Enter') {
      this.handleConfirm();
    }
  }

  handleCancel() {
    if (this._state === 'idle' || this._state === 'running') return;
    this.endSession();
  }

  handleConfirm() {
    if (this._state !== 'confirm') return;
    this.executeDifference();
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
    return hits.length > 0 ? hits[0].object : null;
  }

  // Picking state machine
  selectObject(object) {
    const isValid = object?.isMesh && object.userData?.meshData;

    if (!isValid) {
      // Missed: re-assert the current picks so the outliner/UI stays in sync
      if (this._state === 'pick_first') {
        this.signals.objectSelected.dispatch([]);
      } else if (this._state === 'pick_second') {
        this.signals.objectSelected.dispatch([this._firstObject]);
      }
      return;
    }

    if (this._state === 'pick_first') {
      this._firstObject = object;
      this.selection.highlightObject(object);

      this._state = 'pick_second';
      this.signals.onToolUpdated.dispatch('Select second object');
      this.signals.objectSelected.dispatch([this._firstObject]);
    } else if (this._state === 'pick_second') {
      if (object === this._firstObject) return;

      this._secondObject = object;
      this.selection.highlightObject(object);

      this._state = 'confirm';
      this.signals.onToolUpdated.dispatch({
        text: 'Press Enter to difference, Escape to cancel',
        buttons: [
          { label: 'Escape', variant: 'cancel', onClick: () => this.handleCancel() },
          { label: 'Enter', variant: 'confirm', onClick: () => this.handleConfirm() },
        ],
      });
      this.signals.objectSelected.dispatch([this._firstObject, this._secondObject]);

      this.selection.tool = false;
    }
  }

  // Execution
  async executeDifference() {
    if (this._state !== 'confirm') return;

    const primary = this._firstObject;
    const secondary = this._secondObject;
    this._state = 'running'; // blocks repeat Enter / Escape while the boolean runs

    try {
      const computed = await this.ops.compute(primary, secondary);
      if (computed) {
        this.clearPicks();
        this.ops.commit(primary, secondary, computed);
      }
    } catch (err) {
      console.error('DifferenceTool failed:', err);
    } finally {
      this.endSession();
    }
  }

  // Session teardown: clear highlights, hand selection back, detach input.
  endSession() {
    this.clearPicks();
    this.selection.enable = true;
    this.selection.tool = false;

    this._state = 'idle';
    this._firstObject = null;
    this._secondObject = null;

    this.renderer.domElement.removeEventListener('mousedown', this._onPointerDown);
    window.removeEventListener('keydown', this._onKeyDown);

    this.signals.onToolEnded.dispatch();
  }

  clearPicks() {
    if (this._firstObject) this.selection.unhighlightObject(this._firstObject);
    if (this._secondObject) this.selection.unhighlightObject(this._secondObject);
    this.signals.objectSelected.dispatch([]);
  }
}