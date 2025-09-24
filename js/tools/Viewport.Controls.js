import * as THREE from 'three';
import { VertexEditor } from './VertexEditor.js';
import { SwitchModeCommand } from '../commands/SwitchModeCommand.js';

export default class ViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.cameraManager = editor.cameraManager;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.vertexEditor = null;
    this.currentMode = 'object';

    this.load();
  }

  load() {
    this.uiLoader.loadComponent('#viewport-controls-container', 'components/viewport-controls.html', () => {
      this.setupViewportControls();
      this.setupListeners();
      this.resetCameraOption(this.cameraManager.cameras)
    });
  }

  setupViewportControls() {
    this.cameraDropdown = document.getElementById('cameraDropdown');
    this.shadingDropdown = document.getElementById('shading-modes');
    this.interactionDropdown = document.getElementById('interaction-modes');
    this.selectionModeBar = document.querySelector('.selection-mode');

    if (this.cameraDropdown) {
      this.cameraDropdown.addEventListener('change', (e) => {
        const value = e.target.value;
        this.cameraDropdown.value = value;
        const camera = this.cameraManager.cameras[value];
        this.signals.viewportCameraChanged.dispatch(camera);
      });
    }

    if (this.shadingDropdown) {
      const shadingValue = this.shadingDropdown.value;
      this.signals.viewportShadingChanged.dispatch(shadingValue);

      this.shadingDropdown.addEventListener('change', (e) => {
        const value = e.target.value;
        this.signals.viewportShadingChanged.dispatch(value);
      });
    }

    if (this.interactionDropdown) {
      this.currentMode = this.interactionDropdown.value;
      
      this.interactionDropdown.addEventListener('change', (e) => {
        const newMode = e.target.value;
        const previousMode = this.currentMode;

        const object = previousMode === 'object'
          ? this.selection.selectedObject
          : this.editSelection.editedObject;
        
        if (newMode === 'edit' && !(object && object.isMesh)) {
          alert('No mesh selected. Please select a mesh object.');
          e.target.value = this.currentMode;
          return;
        }

        this.editor.execute(new SwitchModeCommand(this.editor, object, newMode, previousMode));
        this.currentMode = newMode;
      });
    }
  }

  setupListeners() {
    this.signals.cameraAdded.add((cameras) => {
      this.resetCameraOption(cameras);
    });

    this.signals.cameraRemoved.add((cameras) => {
      this.resetCameraOption(cameras);
    });

    this.signals.modeChanged.add((newMode) => {
      this.currentMode = newMode;

      if (this.interactionDropdown) {
        this.interactionDropdown.value = newMode;
      }
      if (this.selectionModeBar) {
        this.selectionModeBar.classList.toggle('hidden', newMode === 'object');
      }
    });
  }

  resetCameraOption(cameras) {
    this.cameraDropdown.innerHTML = '';

    const defaultCamera = Object.values(cameras).find(cam => cam.isDefault);

    const defaultOption = document.createElement('option');
    defaultOption.value = defaultCamera.uuid;
    defaultOption.textContent = 'CAMERA';
    this.cameraDropdown.appendChild(defaultOption);

    Object.values(cameras).forEach((camera) => {
      if (camera.uuid === defaultCamera.uuid) return;

      const option = document.createElement('option');
      option.value = camera.uuid;
      option.textContent = camera.type.toUpperCase();
      this.cameraDropdown.appendChild(option);
    });

    this.cameraDropdown.value = this.cameraManager.camera.uuid;
  }

  enterObjectMode() {
    this.selection.enable = true;

    if (this.vertexEditor) {
      this.vertexEditor.removeVertexPoints();
      this.vertexEditor.removeEdgeLines();
    }

    if (this.editSelection.editedObject) {
      this.editSelection.clearSelection();
      this.selection.select(this.editSelection.editedObject);
      this.editSelection.editedObject = null;
    }
  }

  enterEditMode(selectedObject) {
    this.selection.enable = false;

    this.vertexEditor = new VertexEditor(this.editor, selectedObject);
    this.vertexEditor.addVertexPoints(selectedObject);
    this.vertexEditor.addEdgeLines(selectedObject);

    this.editSelection.editedObject = selectedObject;
    this.editSelection.clearSelection();
    this.selection.deselect();
  }

  toJSON() {
    return {
      mode: this.interactionDropdown?.value || 'object',
      editedObjectUuid: this.editSelection.editedObject?.uuid || null
    };
  }

  fromJSON(json) {
    const mode = json.mode;
    const uuid = json.editedObjectUuid;

    if (mode === 'edit' && uuid) {
      const object = this.editor.objectByUuid(uuid);

      if (object && object.isMesh) {
        this.selection.select(object);
        this.enterEditMode(object);
        this.signals.modeChanged.dispatch('edit');
      }
    }
  }
}