import * as THREE from 'three';
import { SwitchSubModeCommand } from '../commands/SwitchSubModeCommand.js';
import { GenerateTexturePanel } from '../panels/GenerateTexturePanel.js';
import { floatingTooltip } from '../ui/FloatingTooltip.js';

export default class ViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.modeManager = editor.modeManager;
    this.uiLoader = editor.uiLoader;
    this.cameraManager = editor.cameraManager;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.objectActions = editor.objectActions;
    this.editActions = editor.editActions;
    this.uvActions = editor.uvActions;
    this.editHelpers = editor.editHelpers;
    this.panelResizer = editor.panelResizer;
    this.snapManager = editor.snapManager;

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
    this.uvMenu = document.getElementById('uv-menu');
    this.leftControls = document.getElementById('left-controls-container');
    this.transformControls = document.getElementById('transform-controls');
    this.brushSettings = document.getElementById('brush-settings');
    this.paintTargetDropdown = document.getElementById('paint-map-select');
    this.uvPane = document.getElementById('uv-pane');
    this.viewportSplitResizer = document.getElementById('viewport-split-resizer');
    this.viewport3dPane = document.getElementById('viewport-3d-pane');

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
      this.interactionDropdown.value = this.modeManager.currentMode;
      
      this.interactionDropdown.addEventListener('change', (e) => {
        this.requestMode(e.target.value);
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

    this.setupFloatingMenus();
    floatingTooltip.attach(document.querySelector('.viewport-controls'));
  }

  setupListeners() {
    this.signals.cameraAdded.add((cameras) => {
      this.resetCameraOption(cameras);
    });

    this.signals.cameraRemoved.add((cameras) => {
      this.resetCameraOption(cameras);
    });

    this.signals.modeChanged.add((newMode) => {
      if (this.transformOrientationSelect) {
        this.transformOrientation = this.transformOrientationSelect.value;
        this.signals.transformOrientationChanged.dispatch(this.transformOrientation);
      }

      if (this.interactionDropdown) {
        this.interactionDropdown.value = newMode;
      }

      if (this.selectionModeBar) {
        this.selectionModeBar.classList.toggle('hidden', newMode === 'object' || newMode === 'paint');
      }

      if (this.objectMenu) {
        this.objectMenu.classList.toggle('hidden', newMode === 'edit' || newMode === 'uv' || newMode === 'paint');
        this.objectMenu.classList.remove('active');
      }

      if (this.meshMenu) {
        this.meshMenu.classList.toggle('hidden', newMode === 'object' || newMode === 'uv' || newMode === 'paint');
        this.meshMenu.classList.remove('active');
      }

      if (this.selectMenu) {
        this.selectMenu.classList.toggle('hidden', newMode === 'object' || newMode === 'uv' || newMode === 'paint');
        this.selectMenu.classList.remove('active');
      }

      if (this.uvMenu) {
        this.uvMenu.classList.toggle('hidden', newMode !== 'uv');
        this.uvMenu.classList.remove('active');
      }

      if (this.transformControls) {
        this.transformControls.classList.toggle('hidden', newMode === 'uv' || newMode === 'paint');
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

      if (this.uvPane) {
        this.uvPane.classList.toggle('hidden', newMode !== 'uv');
      }
      if (this.viewportSplitResizer) {
        this.viewportSplitResizer.classList.toggle('hidden', newMode !== 'uv');
      }

      if (newMode !== 'uv' && this.viewport3dPane) {
        this.viewport3dPane.style.flex = ''; 
      }

      this.signals.layoutChanged.dispatch();
    });

    this.signals.switchMode.add((newMode) => {
      this.requestMode(newMode);
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
      this.signals.shadingModeChanged.dispatch('solid');
    });

    this.signals.focusSelection.add(() => {
      if (this.modeManager.currentMode === 'edit') {
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

  requestMode(newMode) {
    const { ok } = this.modeManager.requestMode(newMode);

    if (!ok && this.interactionDropdown) {
      this.interactionDropdown.value = this.modeManager.currentMode;
    }
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

  updateXRayButtonState(shadingMode) {
    if (shadingMode === 'wireframe' || shadingMode === 'material') {
      this.xrayButton.classList.add('disabled');
    } else {
      this.xrayButton.classList.remove('disabled');
    }
  }

  setupFloatingMenus() {
    this.menuOverlay = document.createElement('div');
    this.menuOverlay.className = 'floating-menu-overlay';
    document.body.appendChild(this.menuOverlay);

    const menuActionsMap = new Map([
      [this.objectMenu, this.objectActions],
      [this.meshMenu, this.editActions],
      [this.selectMenu, this.editActions],
      [this.uvMenu, this.uvActions],
    ]);

    document.querySelectorAll('.menu-item').forEach(menuItem => {
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingTooltip.hide();

        const rect = menuItem.getBoundingClientRect();
        this.menuOverlay.style.left = `${rect.left}px`;
        this.menuOverlay.style.top = `${rect.bottom}px`;
        this.menuOverlay.style.display = 'block';

        this.menuOverlay._trigger = menuItem;
        this.menuOverlay._actions = menuActionsMap.get(menuItem);

        this.menuOverlay.replaceChildren();

        const submenu = menuItem.querySelector('.submenu');
        if (submenu) {
          const clone = submenu.cloneNode(true);
          clone.style.display = 'block';
          this.menuOverlay.appendChild(clone);
        }
      });

      // Hide when clicking outside
      document.addEventListener('click', (e) => {
        if (
          !this.menuOverlay.contains(e.target) &&
          !e.target.closest('.menu-item')
        ) {
          this.menuOverlay.style.display = 'none';
        }
      });

      // Close menu when hovering outside
      let closeTimeout = null;

      document.addEventListener('mousemove', (e) => {
        if (this.menuOverlay.style.display !== 'block') return;

        const trigger = this.menuOverlay._trigger;
        const insideOverlay = this.menuOverlay.contains(e.target);
        const insideTrigger = trigger && trigger.contains(e.target);

        if (insideOverlay || insideTrigger) {
          clearTimeout(closeTimeout);
          return;
        }

        clearTimeout(closeTimeout);
        closeTimeout = setTimeout(() => {
          this.menuOverlay.style.display = 'none';
        }, 300);
      });
    });

    this.menuOverlay.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;

      e.stopPropagation();

      const actions = this.menuOverlay._actions;
      if (actions) {
        actions.handleAction(item.dataset.action);
      }

      this.menuOverlay.style.display = 'none';
    });

    floatingTooltip.addBlocker(() => this.menuOverlay.style.display === 'block');
  }
}