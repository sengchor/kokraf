import * as THREE from 'three';
import Renderer from './core/Renderer.js';
import SceneManager from './core/SceneManager.js';
import CameraManager from './core/CameraManager.js';
import ControlsManager from './core/ControlsManager.js';
import Toolbar from './tools/Toolbar.js';
import Selection from './tools/Selection.js';
import UIComponentsLoader from './ui/UIComponentsLoader.js';
import PanelResizer from './ui/PanelResizer.js';
import { ViewportViewHelper } from './tools/Viewport.ViewHelper.js';
import Menubar from './ui/Menubar.js';
import { Signal } from './utils/Signals.js';
import { ObjectFactory } from './utils/ObjectFactory.js';
import { History } from './core/History.js';
import { KeyHandler } from './tools/KeyHandler.js';
import ViewportControls from './tools/Viewport.Controls.js';
import Sidebar from './ui/Sidebar.js';
import Config from './core/Config.js';
import { Storage } from './core/Storage.js';
import EditSelection from './tools/EditSelection.js';
import ContextMenu from './ui/ContextMenu.js';
import { MeshEditDispatcher } from './tools/MeshEditDispatcher.js';
import { ObjectEditDispatcher } from './tools/ObjectEditDispatcher.js';

export default class Editor {
  constructor() {
    // Signals
    this.signals = {
      showHelpersChanged: new Signal(),

      viewportCameraChanged: new Signal(),
      viewportShadingChanged: new Signal(),

      cameraAdded: new Signal(),
      cameraRemoved: new Signal(),

      objectAdded: new Signal(),
      objectRemoved: new Signal(),

      objectSelected: new Signal(),
      objectFocused: new Signal(),
      objectChanged: new Signal(),
      objectDeleted: new Signal(),

      historyChanged: new Signal(),
      emptyScene: new Signal(),

      sceneGraphChanged: new Signal(),
      modeChanged: new Signal(),
      multiSelectChanged: new Signal(),

      createFaceFromVertices: new Signal(),
      deleteSelectedFaces: new Signal(),
      separateSelection: new Signal(),
    }

    this.helpers = {};

    // Core setup
    this.config = new Config();
    this.history = new History(this);
    this.renderer = new Renderer(this);
    this.objectFactory = new ObjectFactory(this);
    this.cameraManager = new CameraManager(this);
    this.sceneManager = new SceneManager(this);
    this.controlsManager = new ControlsManager(this);

    // Helpers
    this.viewportViewHelper = new ViewportViewHelper(this);
    this.selection = new Selection(this);
    this.editSelection = new EditSelection(this);
    this.keyHandler = new KeyHandler(this);

    // UI
    this.uiLoader = new UIComponentsLoader();
    this.panelResizer = new PanelResizer(this);
    this.contextMenu = new ContextMenu(this);

    this.clock = new THREE.Clock();

    this.animate = this.animate.bind(this);
  }

  async init() {
    this.viewportControls = new ViewportControls(this);  
    this.toolbar = new Toolbar(this);
    this.menubar = new Menubar(this);
    this.meshEditDispatcher = new MeshEditDispatcher(this);
    this.objectEditDispatcher = new ObjectEditDispatcher(this);

    const saved = await Storage.get('scene');
    if (saved) {
      this.fromJSON(saved);
    } else {
      this.sceneManager.addAmbientLight(0xffffff, 0.5);
      this.sceneManager.addDemoObjects();
    }
    this.sceneManager.sceneEditorHelpers.add(this.sceneManager.gridHelper);

    this.sidebar = new Sidebar(this);
    
    this.setupListeners();
    this.animate();
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      this.cameraManager.camera = camera;
      this.panelResizer.onWindowResize();

      this.viewportViewHelper.setVisible(camera.isDefault);

      this.selection.deselect();
      this.toolbar.updateTools();
    });

    this.signals.historyChanged.add(async () => {
      await Storage.set('scene', this.toJSON());
    });
  }

  animate() {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    this.sceneManager.gridHelper.updateUniforms(this.cameraManager.camera);
    if (this.selection.getSelectedObject()) {
      this.selection.update();
    }

    this.renderer.clearAll();
    this.renderer.render(this.sceneManager.mainScene, this.cameraManager.camera);
    this.renderer.render(this.sceneManager.mainScene, this.cameraManager.camera);
    this.renderer.render(this.sceneManager.sceneHelpers, this.cameraManager.camera);
    this.renderer.render(this.sceneManager.sceneEditorHelpers, this.cameraManager.camera);

    const viewHelperAnimating = this.viewportViewHelper.viewHelper.animating;
    const isDefaultCamera = this.cameraManager.camera.isDefault;
    
    if (viewHelperAnimating) {
      this.controlsManager.disable();
      this.viewportViewHelper.update(delta);
    } else if (!isDefaultCamera) {
      this.controlsManager.disable();
    } else {
      this.controlsManager.enable();
    }

    this.viewportViewHelper.render();
  }

  async fromJSON(json) {
    const loader = new THREE.ObjectLoader();

    const scene = await loader.parseAsync(json.scene);
    this.sceneManager.setScene(scene);

    const camera = await loader.parseAsync(json.camera);
    this.cameraManager.setCamera(camera);

    this.viewportControls.fromJSON(json.viewportControls);
    if (this.config.get('history')) {
      this.history.fromJSON(json.history);
    }
    this.signals.historyChanged.dispatch();
  }

  toJSON() {
    const json = {
      metadata: {
        version: 1.0,
        type: 'Project',
      },
      scene: this.sceneManager.mainScene.toJSON(),
      camera: this.cameraManager.camera.toJSON(),
      viewportControls: this.viewportControls.toJSON(),
    };

    if (this.config.get('history')) {
      json.history = this.history.toJSON();
    }

    return json;
  }

  objectByUuid(uuid) {
    return this.sceneManager.mainScene.getObjectByProperty('uuid', uuid);
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