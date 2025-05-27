import { TransformTool } from '../tools/TransformTool.js';

export class Toolbar {
  constructor({ renderer, camera, scene, controls, sceneHelpers, selectionHelper }) {
    this.canvas = document.getElementById('three-canvas');
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.selectionHelper = selectionHelper;
    this.activeTool = 'select';

    this.moveTool = new TransformTool('translate', camera, renderer, sceneHelpers, controls);
    this.rotateTool = new TransformTool('rotate', camera, renderer, sceneHelpers, controls);
    this.scaleTool = new TransformTool('scale', camera, renderer, sceneHelpers, controls);

    this.handlePointerDown();
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

  handlePointerDown() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (this.moveTool.transformControls.dragging || this.rotateTool.transformControls.dragging || this.scaleTool.transformControls.dragging) return;

      this.selectionHelper.select(event, this.renderer, this.camera, this.scene);
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