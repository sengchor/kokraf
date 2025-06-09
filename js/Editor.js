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
import { Signal } from './utils/Signals.js';
import { ObjectFactory } from './utils/ObjectFactory.js';
import { History } from './core/History.js';
import { KeyHandler } from './tools/KeyHandler.js';

export default class Editor {
  constructor() {
    // Signals
    this.signals = {
      showHelpersChanged: new Signal(),
    }

    this.helpers = {};

    // Core setup
    this.renderer = new Renderer({ canvasId: 'three-canvas' });
    this.objectFactory = new ObjectFactory(this);
    this.sceneManager = new SceneManager(this);
    this.cameraManager = new CameraManager();
    this.controlsManager = new ControlsManager(this);
    this.history = new History(this);

    // Helpers
    this.gridHelper = new GridHelper();
    this.viewHelperUI = new ViewHelperUI(this);
    this.selectionHelper = new Selection(this);

    this.keyHandler = new KeyHandler(this);

    // UI
    this.uiLoader = new UIComponentsLoader();
    this.panelResizer = new PanelResizer({
      renderer: this.renderer,
      cameraManager: this.cameraManager,
      viewHelperUI: this.viewHelperUI,
    });

    this.clock = new THREE.Clock();

    this.animate = this.animate.bind(this);

    // Listen to signals
    this.signals.showHelpersChanged.add((states) => {
      this.gridHelper.visible = states.gridHelper;
      
      this.sceneManager.sceneHelpers.traverse((object) => {
        switch(object.type) {
          case 'CameraHelper':
            object.visible = states.cameraHelpers;
            break;

          case 'PointLightHelper':
          case 'DirectionalLightHelper':
          case 'SpotLightHelper':
          case 'HemisphereLightHelper':
            object.visible = states.lightHelpers;
            break;

          case 'SkeletonHelper':
            object.visible = states.skeletonHelpers;
            break;

          default:
            break;
        }
      })
    });
  }

  init() {    
    this.sceneManager.addAmbientLight(0xffffff, 0.5);
    this.sceneManager.sceneEditorHelpers.add(this.gridHelper);
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
    this.renderer.render(this.sceneManager.sceneEditorHelpers, this.cameraManager.camera);

    if (this.viewHelperUI.viewHelper.animating) {
      this.controlsManager.disable();
      this.viewHelperUI.viewHelper.update(delta);
    } else {
      this.controlsManager.enable();
    }
    this.viewHelperUI.render();
  }

  fromJSON(json) {
    const loader = new THREE.ObjectLoader();

    this.sceneManager.emptyAllScenes();

    const scene = loader.parse(json.scene);
    this.sceneManager.setScene(scene);

    const camera = loader.parse(json.camera);
    this.cameraManager.setCamera(camera);
  }

  toJSON() {
    return {
      metadata: {
        version: 1.0,
        type: 'Project',
      },
      scene: this.sceneManager.mainScene.toJSON(),
      camera: this.cameraManager.camera.toJSON()
    }
  }

  execute(cmd) {
    this.history.execute(cmd);
  }

  undo() {
    this.history.undo();
  }

  redo() {
    this.history.redo();
  }
}