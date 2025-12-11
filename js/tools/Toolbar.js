import { TransformTool } from '../tools/TransformTool.js';
import { ExtrudeTool } from '../tools/ExtrudeTool.js';
import { LoopCutTool } from '../tools/LoopCutTool.js';
import { KnifeTool } from '../tools/KnifeTool.js';

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
    this.viewportControls = editor.viewportControls;
    this.activeToolObjectMode = 'select';
    this.activeToolEditMode = 'select';
    this.currentMode = 'object';
    this.isTransformDragging = false;

    this.moveTool = new TransformTool('translate', this.editor);
    this.rotateTool = new TransformTool('rotate', this.editor);
    this.scaleTool = new TransformTool('scale', this.editor);
    this.extrudeTool = new ExtrudeTool(this.editor);
    this.loopCutTool = new LoopCutTool(this.editor);
    this.knifeTool = new KnifeTool(this.editor);

    this.load();
  }

  load() {
    this.uiLoader.loadComponent('#toolbar-container', 'components/toolbar.html', () => {
      this.buttons = document.querySelectorAll('.toolbar-button');
      this.setupToolbarButtons();
      this.setupListeners();

      this.currentMode = this.viewportControls.currentMode;
      this.updateTools();
      if (this.meshToolContainer) {
        this.meshToolContainer.classList.toggle('hidden', this.currentMode === 'object');
      }
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

    this.signals.transformDragStarted.add(() => {
      this.isTransformDragging = true;
    });

    this.signals.transformDragEnded.add(() => {
      this.isTransformDragging = false;
    });

    const onSelectionUpdate = () => {
      if (this.isTransformDragging) return;

      const activeTool = this.getActiveTool();
      if (['move', 'rotate', 'scale', 'extrude'].includes(activeTool)) {
        this.updateTools();
      }
    };

    this.signals.editSelectionChanged.add(onSelectionUpdate);
    this.signals.editSelectionCleared.add(onSelectionUpdate);
    this.signals.objectSelected.add(onSelectionUpdate);
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

  updateTools() {
    let activeTool = this.getActiveTool();
    let attachObject = null;

    if (this.currentMode === 'object') {
      attachObject = this.selection.pivotHandle;
    } else {
      attachObject = this.editSelection.vertexHandle;
    }
    if (!attachObject.visible) attachObject = null;

    this.updateActiveTools(activeTool, attachObject);
    this.buttons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === activeTool);
    });
  }

  disableTools() {
    this.moveTool.disable();
    this.rotateTool.disable();
    this.scaleTool.disable();
    this.extrudeTool.disable();
    this.loopCutTool.disable();
    this.knifeTool.disable();
  }

  updateActiveTools(activeTool, attachObject) {
    this.disableTools();

    switch (activeTool) {
      case 'move':   this.moveTool.enableFor(attachObject); break;
      case 'rotate': this.rotateTool.enableFor(attachObject); break;
      case 'scale':  this.scaleTool.enableFor(attachObject); break;
      case 'extrude': this.extrudeTool.enableFor(attachObject); break;
      case 'loopcut' : this.loopCutTool.enable(); break;
      case 'knife' : this.knifeTool.enable(); break;
    }
  }
}