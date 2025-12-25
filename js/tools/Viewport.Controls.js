import * as THREE from 'three';
import { SwitchModeCommand } from '../commands/SwitchModeCommand.js';
import { SwitchSubModeCommand } from '../commands/SwitchSubModeCommand.js';

export default class ViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.cameraManager = editor.cameraManager;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.editHelpers = editor.editHelpers;
    this.panelResizer = editor.panelResizer;
    this.snapManager = editor.snapManager;
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
    this.snapButton = document.querySelector('.snap-button');
    this.snappingSelect = document.getElementById('snapping-to');

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
        this.switchMode(e.target.value);
      });
    }

    if (this.selectionModeBar) {
      this.selectionButtons = this.selectionModeBar.querySelectorAll('.selection-button');
      this.selectionButtons.forEach(button => {
        button.addEventListener('click', () => {
          this.selectionButtons.forEach(b => b.classList.remove('active'));
          button.classList.add('active');

          const newMode = button.dataset.tool;
          const currentMode = this.editSelection.subSelectionMode;
          if (newMode === currentMode) return;

          this.editor.execute(new SwitchSubModeCommand(this.editor, newMode, currentMode));
        })
      })
    }

    if (this.snapButton) {
      const enabled = this.snapButton.classList.contains('active');
      this.snapManager.setEnabled(enabled);
      this.snapButton.addEventListener('click', () => {
        const active = this.snapButton.classList.toggle('active');
        this.snapManager.setEnabled(active);
      })
    }

    if (this.snappingSelect) {
      this.snapManager.setSnapMode(this.snappingSelect.value);
      this.snappingSelect.addEventListener('change', (e) => {
        this.snapManager.setSnapMode(e.target.value);
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

    this.signals.switchMode.add((newMode) => {
      this.switchMode(newMode);
    });

    this.signals.subSelectionModeChanged.add((newMode) => {
      if (this.selectionButtons) {
        this.selectionButtons.forEach(button => {
          button.classList.toggle('active', button.dataset.tool === newMode);
        });
      }

      this.editHelpers.refreshHelpers();
      this.editSelection.updateVertexHandle();
    });

    this.signals.emptyScene.add(() => {
      this.editSelection.setSubSelectionMode('vertex');
      this.signals.subSelectionModeChanged.dispatch('vertex');

      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
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
    this.panelResizer.onWindowResize();
  }

switchMode(newMode) {
  const previousMode = this.currentMode;

  let object = null;

  if (previousMode === 'object') {
    const selected = this.selection.selectedObjects;

    if (newMode === 'edit') {
      if (selected.length !== 1) {
        alert('Please select one mesh to enter Edit Mode.');
        this.interactionDropdown.value = previousMode;
        return;
      }

      object = selected[0];
    } else {
      object = this.editSelection.editedObject;
    }
  } else {
    object = this.editSelection.editedObject;
  }


  if (newMode === 'edit' && !(object && object.isMesh)) {
    alert('No mesh selected. Please select a mesh object.');
    this.interactionDropdown.value = previousMode;
    return;
  }

  this.editor.execute(new SwitchModeCommand(this.editor, object, newMode, previousMode));
  this.currentMode = newMode;
}

  enterObjectMode() {
    this.selection.enable = true;
    this.editSelection.enable = false;

    if (this.editHelpers) {
      this.editHelpers.removeVertexPoints();
      this.editHelpers.removeEdgeLines();
    }

    if (this.editSelection.editedObject) {
      this.editSelection.clearSelection();
      this.selection.select(this.editSelection.editedObject);
      this.editSelection.editedObject = null;
    }
  }

  enterEditMode(selectedObject) {
    this.selection.enable = false;
    this.editSelection.enable = true;

    this.editSelection.editedObject = selectedObject;
    this.editHelpers.refreshHelpers();
    this.editSelection.clearSelection();
    this.selection.deselect();
  }

  toJSON() {
    return {
      mode: this.interactionDropdown?.value || 'object',
      editedObjectUuid: this.editSelection.editedObject?.uuid || null,
      subSelectionMode: this.editSelection.subSelectionMode || 'vertex'
    };
  }

  fromJSON(json) {
    const mode = json.mode;
    const uuid = json.editedObjectUuid;
    const subMode = json.subSelectionMode || 'vertex';

    this.editSelection.setSubSelectionMode(subMode);
    this.signals.subSelectionModeChanged.dispatch(subMode);

    if (mode === 'edit' && uuid) {
      const object = this.editor.objectByUuid(uuid);

      if (object && object.isMesh) {
        this.selection.select(object);
        this.enterEditMode(object);
        this.signals.modeChanged.dispatch('edit');
      }
    } else {
      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
    }
  }
}