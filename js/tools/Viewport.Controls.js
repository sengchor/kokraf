import * as THREE from 'three';
import { SwitchModeCommand } from '../commands/SwitchModeCommand.js';
import { SwitchSubModeCommand } from '../commands/SwitchSubModeCommand.js';
import { GenerateTexturePanel } from '../panels/GenerateTexturePanel.js';
import { TexturePainter } from '../texture/TexturePainter.js';

export default class ViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.cameraManager = editor.cameraManager;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.objectActions = editor.objectActions;
    this.editActions = editor.editActions;
    this.editHelpers = editor.editHelpers;
    this.panelResizer = editor.panelResizer;
    this.snapManager = editor.snapManager;
    this.currentMode = 'object';
    this.transformOrientation = 'global';

    this.ready = this.load();
  }

  async load() {
    await this.uiLoader.loadComponent('#viewport-controls-container', 'components/viewport-controls.html');

    this.setupViewportControls();
    this.setupListeners();
    this.resetCameraOption(this.cameraManager.cameras);

    this.generateTexturePanel = new GenerateTexturePanel(this.editor);
  }

  setupViewportControls() {
    this.cameraDropdown = document.getElementById('cameraDropdown');
    this.shadingDropdown = document.getElementById('shading-modes');
    this.interactionDropdown = document.getElementById('interaction-modes');
    this.selectionModeBar = document.querySelector('.selection-mode');
    this.snapButton = document.querySelector('.snap-button');
    this.snappingSelect = document.getElementById('snapping-to');
    this.transformOrientationSelect = document.getElementById('transform-orientation');
    this.xrayButton = document.getElementById('xray-button');
    this.objectMenu = document.getElementById('object-menu');
    this.meshMenu = document.getElementById('mesh-menu');
    this.selectMenu = document.getElementById('select-menu');
    this.leftControls = document.getElementById('left-controls-container');
    this.transformControls = document.getElementById('transform-controls');
    this.brushSettings = document.getElementById('brush-settings');
    this.paintTargetDropdown = document.getElementById('paint-map-select');

    if (this.cameraDropdown) {
      this.cameraDropdown.addEventListener('change', (e) => {
        const value = e.target.value;
        this.cameraDropdown.value = value;
        const camera = this.cameraManager.cameras[value];
        this.selection.deselect();
        this.signals.viewportCameraChanged.dispatch(camera);
      });
    }

    if (this.shadingDropdown) {
      const shadingValue = this.shadingDropdown.value;
      this.signals.viewportShadingChanged.dispatch(shadingValue);
      this.updateXRayButtonState(shadingValue);

      this.shadingDropdown.addEventListener('change', (e) => {
        const value = e.target.value;
        this.signals.viewportShadingChanged.dispatch(value);
        this.updateXRayButtonState(value);
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

    if (this.transformOrientationSelect) {
      this.transformOrientation = this.transformOrientationSelect.value;
      this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
      this.transformOrientationSelect.addEventListener('change', (e) => {
        this.transformOrientation = e.target.value;
        this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
      });
    }

    if (this.xrayButton) {
      const enabled = this.xrayButton.classList.contains('active');
      this.signals.viewportXRayChanged.dispatch(enabled);
      this.xrayButton.addEventListener('click', () => {
        const active = this.xrayButton.classList.toggle('active');
        this.signals.viewportXRayChanged.dispatch(active);
      });
    }

    if (this.leftControls) {
      this.leftControlsResizeObserver = new ResizeObserver(() => {
        this.signals.layoutChanged.dispatch();
      });

      this.leftControlsResizeObserver.observe(this.leftControls);
    }

    if (this.objectMenu) {
      this.initMenu(this.objectMenu, this.objectActions);
    }

    if (this.meshMenu) {
      this.initMenu(this.meshMenu, this.editActions);
    }

    if (this.selectMenu) {
      this.initMenu(this.selectMenu, this.editActions);
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
        this.selectionModeBar.classList.toggle('hidden', newMode === 'object' || newMode === 'paint');
      }

      if (this.objectMenu) {
        this.objectMenu.classList.toggle('hidden', newMode === 'edit' || newMode === 'paint');
        this.objectMenu.classList.remove('active');
      }

      if (this.meshMenu) {
        this.meshMenu.classList.toggle('hidden', newMode === 'object' || newMode === 'paint');
        this.meshMenu.classList.remove('active');
      }

      if (this.selectMenu) {
        this.selectMenu.classList.toggle('hidden', newMode === 'object' || newMode === 'paint');
        this.selectMenu.classList.remove('active');
      }

      if (this.transformControls) {
        this.transformControls.classList.toggle('hidden', newMode === 'paint');
        this.transformControls.classList.remove('active');
      }

      if (this.brushSettings) {
        this.brushSettings.classList.toggle('hidden', newMode !== 'paint');
        this.brushSettings.classList.remove('active');
      }

      if (this.paintTargetDropdown) {
        this.paintTargetDropdown.classList.toggle('hidden', newMode !== 'paint');
        this.paintTargetDropdown.classList.remove('active');
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

      this.signals.editSelectionRefresh.dispatch();
      this.editSelection.updateVertexHandle();
    });

    this.signals.emptyScene.add(() => {
      this.editSelection.setSubSelectionMode('vertex');
      this.signals.subSelectionModeChanged.dispatch('vertex');

      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
    });

    this.signals.focusSelection.add(() => {
      if (this.currentMode === 'edit') {
        this.signals.vertexFocused.dispatch();
      } else {
        this.signals.objectFocused.dispatch();
      }
    });

    this.signals.shadingModeChanged.add((shadingMode) => {
      this.shadingDropdown.value = shadingMode;
      this.shadingDropdown.dispatchEvent(new Event('change', { bubbles: true }));
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
      option.textContent = camera.name.toUpperCase();
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
      } else if (newMode === 'paint') {
        if (selected.length !== 1) {
          alert('Please select one mesh to enter Texture Paint.');
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

    if (newMode === 'edit' && (!object?.isMesh || object.userData?.isImageRef)) {
      alert('No mesh selected. Please select a mesh object.');
      this.interactionDropdown.value = previousMode;
      return;
    }

    if (newMode === 'paint' && (!object?.isMesh || object.userData?.isImageRef)) {
      alert('No mesh selected. Please select a mesh object.');
      this.interactionDropdown.value = previousMode;
      return;
    }

    this.editor.execute(new SwitchModeCommand(this.editor, object, newMode, previousMode));
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

    if (this.texturePainter) {
      this.texturePainter.detach();
    }

    this.transformOrientation = this.transformOrientationSelect.value;
    this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
  }

  enterEditMode(selectedObject) {
    this.selection.enable = false;
    this.editSelection.enable = true;

    this.editSelection.editedObject = selectedObject;
    this.signals.editSelectionRefresh.dispatch();
    this.editSelection.clearSelection();
    this.selection.deselect();

    if (this.texturePainter) {
      this.texturePainter.detach();
    }

    this.transformOrientation = this.transformOrientationSelect.value;
    this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
    this.signals.objectSelected.dispatch([selectedObject]);

    this.signals.setEditObjectPanel.dispatch(selectedObject);
  }

  enterPaintMode(selectedObject) {
    this.selection.enable = false;
    this.editSelection.enable = false;

    if (this.editHelpers) {
      this.editHelpers.removeVertexPoints();
      this.editHelpers.removeEdgeLines();
    }

    this.editSelection.editedObject = selectedObject;
    this.editSelection.clearSelection();
    this.selection.deselect();

    if (!this.texturePainter) {
      this.texturePainter = new TexturePainter(this.editor);
    }

    this.texturePainter.attach(selectedObject).catch(err => {
      alert(err.message);
      this.interactionDropdown.value = 'object';
      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
    });

    this.transformOrientation = this.transformOrientationSelect.value;
    this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
    this.signals.objectSelected.dispatch([selectedObject]);

    this.signals.setPaintObjectPanel.dispatch(selectedObject);
  }

  updateXRayButtonState(shadingMode) {
    if (shadingMode === 'wireframe' || shadingMode === 'material') {
      this.xrayButton.classList.add('disabled');
    } else {
      this.xrayButton.classList.remove('disabled');
    }
  }

  initMenu(menu, actions) {
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;

      e.stopPropagation();
      actions.handleAction(item.dataset.action);

      menu.classList.remove('active');
      menu.classList.add('menu-closing');

      requestAnimationFrame(() => menu.classList.remove('menu-closing'));
    });
  }

  toJSON() {
    return {
      mode: this.interactionDropdown?.value || 'object',
      editedObjectUuid: this.editSelection.editedObject?.uuid || null,
      subSelectionMode: this.editSelection.subSelectionMode || 'vertex'
    };
  }

  fromJSON(json) {
    if (!json) {
      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
      return;
    }

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
      } else {
        this.enterObjectMode();
        this.signals.modeChanged.dispatch('object');
      }
    } else if (mode === 'paint' && uuid) {
      const object = this.editor.objectByUuid(uuid);

      if (object && object.isMesh) {
        this.selection.select(object);
        this.enterPaintMode(object);
        this.signals.modeChanged.dispatch('paint');
      } else {
        this.enterObjectMode();
        this.signals.modeChanged.dispatch('object');
      }
    } else {
      this.enterObjectMode();
      this.signals.modeChanged.dispatch('object');
    }
  }
}