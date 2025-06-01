import * as THREE from 'three';
import Renderer from './core/Renderer.js';
import SceneManager from './core/SceneManager.js';
import CameraManager from './core/CameraManager.js';
import ControlsManager from './core/ControlsManager.js';
import { GridHelper } from './helpers/GridHelper.js';
import Toolbar from './tools/Toolbar.js';
import Selection from './tools/Selection.js';
import UIComponentsLoader from './ui/UIComponentsLoader.js';
import PanelResizer from './ui/PanelResizer.js';
import { ViewHelperUI } from './helpers/ViewHelperUI.js';
import Menubar from './ui/Menubar.js';

export default class Editor {
  constructor() {
    // Core setup
    this.renderer = new Renderer({ canvasId: 'three-canvas' });
    this.sceneManager = new SceneManager();
    this.cameraManager = new CameraManager();
    this.controlsManager = new ControlsManager({
      camera: this.cameraManager.camera,
      domElement: this.renderer.domElement,
    });

    // Helpers
    this.gridHelper = new GridHelper();
    this.viewHelperUI = new ViewHelperUI(this.cameraManager.camera);
    this.selectionHelper = new Selection(this.sceneManager.sceneHelpers);

    // UI
    this.uiLoader = new UIComponentsLoader();
    this.panelResizer = new PanelResizer({
      renderer: this.renderer,
      cameraManager: this.cameraManager,
      viewHelperUI: this.viewHelperUI,
    });

    this.clock = new THREE.Clock();

    this.animate = this.animate.bind(this);
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  init() {    
    this.sceneManager.addAmbientLight(0xffffff, 0.5);
    this.sceneManager.sceneGridHelper.add(this.gridHelper);
    this.sceneManager.addDemoObjects();

    this.uiLoader.loadUIComponents(this.panelResizer);
    
    this.toolbar = new Toolbar(this);
    this.menubar = new Menubar(this);

    this.animate();
  }


  animate() {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    this.gridHelper.updateUniforms(this.cameraManager.camera);
    if (this.selectionHelper.getSelectedObject()) {
      this.selectionHelper.update();
    }

    this.renderer.clearAll();
    this.renderer.render(this.sceneManager.mainScene, this.cameraManager.camera);
    this.renderer.renderWithOutline(this.sceneManager.mainScene, this.cameraManager.camera);
    this.renderer.render(this.sceneManager.sceneHelpers, this.cameraManager.camera);
    this.renderer.render(this.sceneManager.sceneGridHelper, this.cameraManager.camera);

    if (this.viewHelperUI.viewHelper.animating) {
      this.controlsManager.disable();
      this.viewHelperUI.viewHelper.update(delta);
    } else {
      this.controlsManager.enable();
    }
    this.viewHelperUI.render();
  }

  onKeyDown(event) {
    if (event.key === 'Delete') {
      const selected = this.selectionHelper.getSelectedObject();
      if (selected && selected.parent) {
        selected.parent.remove(selected);
        this.selectionHelper.deselect();
        this.toolbar.updateTools();
      }
    }
  }
}