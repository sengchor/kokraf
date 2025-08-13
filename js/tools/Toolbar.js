import { TransformTool } from '../tools/TransformTool.js';

export default class Toolbar {
  constructor( editor ) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.canvas = document.getElementById('three-canvas');
    this.renderer = editor.renderer;
    this.camera = editor.cameraManager.camera;
    this.selectionHelper = editor.selectionHelper;
    this.editSelection = editor.editSelection;
    this.activeTool = 'select';

    this.moveTool = new TransformTool('translate', this.editor);
    this.rotateTool = new TransformTool('rotate', this.editor);
    this.scaleTool = new TransformTool('scale', this.editor);

    this.load();
    this.handlePointerDown();
  }

  load() {
    this.uiLoader.loadComponent('#toolbar-container', 'components/toolbar.html', (container) => {
      this.setupToolbarButtons(container);
      this.setupListeners();
    });
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.updateTools();
    });
  }

  setupToolbarButtons(container) {
    const buttons = container.querySelectorAll('.toolbar-button');

    buttons.forEach(button => {
      button.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        button.classList.add('active');

        this.activeTool = button.getAttribute('data-tool');

        this.updateTools();
      });
    });
  }

  setActiveTool(toolName) {
    this.activeTool = toolName;
    this.updateTools();

    const buttons = document.querySelectorAll('.toolbar-button');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === toolName);
    });
  }

  handlePointerDown() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (this.moveTool.transformControls.dragging || this.rotateTool.transformControls.dragging || this.scaleTool.transformControls.dragging) return;

      this.interactionDropdown = document.getElementById('interaction-modes');
      if (this.interactionDropdown.value === 'object') {
        this.selectionHelper.onMouseSelect(event, this.renderer, this.camera);
      } else {
        this.editSelection.onMouseSelect(event, this.renderer, this.camera);
      }
      this.updateTools();
    });
  }

  updateTools() {
    this.interactionDropdown = document.getElementById('interaction-modes');
    const interactionMode = this.interactionDropdown.value;

    let attachObject = null;

    if (interactionMode === 'object') {
      attachObject = this.selectionHelper.selectedObject;
    } else {
      attachObject = this.editSelection.vertexHandle;
      if (attachObject.visible === false) {
        attachObject = null;
      }
    }

    if (attachObject && this.activeTool === 'move') {
      this.moveTool.enableFor(attachObject);
      this.rotateTool.disable();
      this.scaleTool.disable();
    } else if (attachObject && this.activeTool === 'rotate') {
      this.rotateTool.enableFor(attachObject);
      this.moveTool.disable();
      this.scaleTool.disable();
    } else if (attachObject && this.activeTool == 'scale') {
      this.scaleTool.enableFor(attachObject);
      this.moveTool.disable();
      this.rotateTool.disable();
    } else {
      this.moveTool.disable();
      this.rotateTool.disable();
      this.scaleTool.disable();
    }
  }
}