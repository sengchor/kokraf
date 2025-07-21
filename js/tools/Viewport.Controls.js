import * as THREE from 'three';
import { MatcapWireframeMaterial } from '../materials/MatcapWireframeMaterial.js';
import { GeometryEditor } from './GeometryEditor.js'

export default class ViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.cameraManager = editor.cameraManager;
    this.selectionHelper = editor.selectionHelper;
    this.sceneManager = editor.sceneManager;
    this.editedObject = null;
    this.geometryEditor = null;

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
    const selectionModeBar = document.querySelector('.selection-mode');

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
      let previousMode = this.interactionDropdown.value;
      
      this.interactionDropdown.addEventListener('change', (e) => {
        const value = e.target.value;
        const selectedObject = this.selectionHelper.getSelectedObject();

        if (value === 'edit' && !selectedObject) {
          alert('No object selected. Please select an object.');
          e.target.value = previousMode;
          return;
        }

        if (value === 'object') {
          selectionModeBar.classList.add('hidden');
          this.signals.modeChanged.dispatch('object');
          this.enterObjectMode();
        } else if (value === 'edit') {
          this.geometryEditor = new GeometryEditor(selectedObject);

          selectionModeBar.classList.remove('hidden');
          this.signals.modeChanged.dispatch('edit');
          this.enterEditMode(selectedObject);
        }
      });
    }
  }

  setupListeners() {
    this.signals.cameraAdded.add((cameras) => {
      this.resetCameraOption(cameras);
    });

    this.signals.cameraRemoved.add((cameras) => {
      this.resetCameraOption(cameras);
    })
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
    this.selectionHelper.enable = true;
    this.signals.viewportShadingChanged.dispatch(this.shadingDropdown.value);

    this.sceneManager.mainScene.traverse((obj) => {
      if (obj.isMesh && obj.userData.originalMaterial) {
        obj.material = obj.userData.originalMaterial;
        delete obj.userData.originalMaterial;
      }

      this.geometryEditor.removeVertexPoints(obj);
    });

    if (this.editedObject) {
      this.selectionHelper.select(this.editedObject);
      this.editedObject = null;
    }
  }

  enterEditMode(selectedObject) {
    this.selectionHelper.enable = false;
    this.sceneManager.mainScene.overrideMaterial = null;
    this.editor.toolbar.setActiveTool('select');

    const matcapTexture = new THREE.TextureLoader().load('assets/textures/matcaps/040full.jpg');

    const sharedMatcapMaterial = new THREE.MeshMatcapMaterial({
      matcap: matcapTexture,
      color: 0xcccccc,
      side: THREE.DoubleSide
    });

    this.sceneManager.mainScene.traverse((obj) => {
      if (obj.isMesh) {
        if (!obj.userData.originalMaterial) {
          obj.userData.originalMaterial = obj.material;
        }
        obj.material = sharedMatcapMaterial;
      }
    });

    const wireframeMaterial = new MatcapWireframeMaterial(matcapTexture, {
      tintColor: 0xcccccc,
      wireframeColor: 0x000000,
      wireframeOpacity: 0
    });

    this.geometryEditor.applyBarycentricCoordinates(selectedObject);
    selectedObject.material = wireframeMaterial;

    this.geometryEditor.addVertexPoints(selectedObject);

    this.editedObject = selectedObject;
    this.selectionHelper.deselect();
  }
}