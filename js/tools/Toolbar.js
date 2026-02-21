import { ObjectTransformTool } from '../tools/ObjectTransformTool.js';
import { EditTransformTool } from '../tools/EditTransformTool.js';
import { ExtrudeTool } from '../tools/ExtrudeTool.js';
import { LoopCutTool } from '../tools/LoopCutTool.js';
import { KnifeTool } from '../tools/KnifeTool.js';
import { DuplicateTool } from '../tools/DuplicateTool.js';
import { BevelTool } from '../tools/BevelTool.js';

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

    this.objectMoveTool   = new ObjectTransformTool(this.editor, 'translate');
    this.objectRotateTool = new ObjectTransformTool(this.editor, 'rotate');
    this.objectScaleTool  = new ObjectTransformTool(this.editor, 'scale');

    this.editMoveTool   = new EditTransformTool(this.editor, 'translate');
    this.editRotateTool = new EditTransformTool(this.editor, 'rotate');
    this.editScaleTool  = new EditTransformTool(this.editor, 'scale');

    this.extrudeTool = new ExtrudeTool(this.editor);
    this.loopCutTool = new LoopCutTool(this.editor);
    this.knifeTool = new KnifeTool(this.editor);
    this.duplicateTool = new DuplicateTool(this.editor);
    this.bevelTool = new BevelTool(this.editor);

    this.ready = this.load();
  }

  async load() {
    await this.uiLoader.loadComponent('#toolbar-container', 'components/toolbar.html');
    this.buttons = document.querySelectorAll('.toolbar-button');
    this.setupToolbarButtons();
    this.setupListeners();

    this.currentMode = this.viewportControls.currentMode;
    this.updateTools();
    if (this.meshToolContainer) {
      this.meshToolContainer.classList.toggle('hidden', this.currentMode === 'object');
    }
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
      if (['move', 'rotate', 'scale', 'extrude', 'bevel'].includes(activeTool)) {
        this.updateTools();
      }
    };

    this.signals.editSelectionChanged.add(onSelectionUpdate);
    this.signals.editSelectionCleared.add(onSelectionUpdate);
    this.signals.objectSelected.add(onSelectionUpdate);
    this.signals.subSelectionModeChanged.add(onSelectionUpdate);
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
    const current = this.getActiveTool();
    if (current === toolName) return;

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
      this.selection.updatePivotHandle();
      attachObject = this.selection.pivotHandle;
    } else {
      this.editSelection.updateVertexHandle();
      attachObject = this.editSelection.vertexHandle;
    }
    if (!attachObject.visible) attachObject = null;

    this.updateActiveTools(activeTool, attachObject);
    this.buttons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === activeTool);
    });
  }

  disableTools() {
    this.objectMoveTool.disable();
    this.objectRotateTool.disable();
    this.objectScaleTool.disable();

    this.editMoveTool.disable();
    this.editRotateTool.disable();
    this.editScaleTool.disable();

    this.extrudeTool.disable();
    this.loopCutTool.disable();
    this.knifeTool.disable();
    this.bevelTool.disable();
  }

  updateActiveTools(activeTool, attachObject) {
    this.disableTools();
    const isObjectMode = this.currentMode === 'object';

    // Disable selection for some tools
    if (isObjectMode) {
      this.editSelection.enable = false;
    } else {
      this.editSelection.enable = !['loopcut', 'knife'].includes(activeTool);
    }

    switch (activeTool) {
      case 'move':
        isObjectMode ? this.objectMoveTool.enableFor(attachObject) : this.editMoveTool.enableFor(attachObject);
        break;
        
      case 'rotate':
        isObjectMode ? this.objectRotateTool.enableFor(attachObject) : this.editRotateTool.enableFor(attachObject);
        break;

      case 'scale':
        isObjectMode ? this.objectScaleTool.enableFor(attachObject) : this.editScaleTool.enableFor(attachObject);
        break;
      
      case 'extrude': this.extrudeTool.enableFor(attachObject); break;
      case 'loopcut' : this.loopCutTool.enable(); break;
      case 'knife' : this.knifeTool.enable(); break;
      case 'bevel' : this.bevelTool.enableFor(attachObject); break;
    }
  }
}