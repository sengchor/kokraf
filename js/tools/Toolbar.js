import { TransformTool } from '../tools/TransformTool.js';

export default class Toolbar {
  constructor( editor ) {
    this.editor = editor;
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

      const interactionDropdown = document.getElementById('interaction-modes');
      if (interactionDropdown.value === 'object') {
        this.selectionHelper.onMouseSelect(event, this.renderer, this.camera);
      } else {
        this.editSelection.onMouseSelect(event, this.renderer, this.camera);
      }
      this.updateTools();
    });
  }

  updateTools() {
    const selectedObject = this.selectionHelper.getSelectedObject();

    if (selectedObject && this.activeTool === 'move') {
      this.moveTool.enableFor(selectedObject);
      this.rotateTool.disable();
      this.scaleTool.disable();
    } else if (selectedObject && this.activeTool === 'rotate') {
      this.rotateTool.enableFor(selectedObject);
      this.moveTool.disable();
      this.scaleTool.disable();
    } else if (selectedObject && this.activeTool == 'scale') {
      this.scaleTool.enableFor(selectedObject);
      this.moveTool.disable();
      this.rotateTool.disable();
    } else {
      this.moveTool.disable();
      this.rotateTool.disable();
      this.scaleTool.disable();
    }
  }
}