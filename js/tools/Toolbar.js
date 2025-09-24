import { TransformTool } from '../tools/TransformTool.js';

export default class Toolbar {
  constructor( editor ) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.canvas = document.getElementById('three-canvas');
    this.renderer = editor.renderer;
    this.camera = editor.cameraManager.camera;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.activeToolObjectMode = 'select';
    this.activeToolEditMode = 'select';
    this.currentMode = 'object';

    this.moveTool = new TransformTool('translate', this.editor);
    this.rotateTool = new TransformTool('rotate', this.editor);
    this.scaleTool = new TransformTool('scale', this.editor);

    this.load();
    this.handlePointerDown();
  }

  load() {
    this.uiLoader.loadComponent('#toolbar-container', 'components/toolbar.html', () => {
      this.buttons = document.querySelectorAll('.toolbar-button');
      this.setupToolbarButtons();
      this.setupListeners();
    });
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.currentMode = newMode;
      this.updateTools();

      if (this.meshToolContainer) {
        this.meshToolContainer.classList.toggle('hidden', newMode === 'object');
      }
    });

    this.signals.emptyScene.add(() => {
      this.disableTools();
    });
  }

  setupToolbarButtons() {
    this.meshToolContainer = document.querySelector('.mesh-tools');

    this.buttons.forEach(button => {
      button.addEventListener('click', () => {
        const toolName = button.getAttribute('data-tool');
        this.setActiveTool(toolName);
      });
    });
  }

  getActiveTool() {
    return this.currentMode === 'object' 
      ? this.activeToolObjectMode 
      : this.activeToolEditMode;
  }

  setActiveTool(toolName) {
    if (this.currentMode === 'object') {
      this.activeToolObjectMode = toolName;
    } else {
      this.activeToolEditMode = toolName;
    }
    this.updateTools();
  }

  handlePointerDown() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (this.moveTool.transformControls.dragging || this.rotateTool.transformControls.dragging || this.scaleTool.transformControls.dragging) return;

      if (this.currentMode === 'object') {
        this.selection.onMouseSelect(event, this.renderer, this.camera);
      } else {
        this.editSelection.onMouseSelect(event, this.renderer, this.camera);
      }
      this.updateTools();
    });
  }

  updateTools() {
    let activeTool = this.getActiveTool();
    let attachObject = null;

    if (this.currentMode === 'object') {
      attachObject = this.selection.selectedObject;
    } else {
      attachObject = this.editSelection.vertexHandle;
      if (attachObject.visible === false) {
        attachObject = null;
      }
    }

    this.updateTransformTools(activeTool, attachObject);
    this.buttons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === activeTool);
    });
  }

  disableTools() {
    this.moveTool.disable();
    this.rotateTool.disable();
    this.scaleTool.disable();
  }

  updateTransformTools(activeTool, attachObject) {
    this.disableTools();
    if (!attachObject) return;

    switch (activeTool) {
      case 'move':   this.moveTool.enableFor(attachObject); break;
      case 'rotate': this.rotateTool.enableFor(attachObject); break;
      case 'scale':  this.scaleTool.enableFor(attachObject); break;
    }
  }
}