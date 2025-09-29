import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";

export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.selection = editor.selection;
    this.shortcuts = null;
    
    this.init();
  }

  async init() {
    await this.config.loadSettings();
    this.shortcuts = this.config.get('shortcuts');

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }

    if (event.ctrlKey && event.key === this.shortcuts['undo']) {
      this.editor.undo();
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === this.shortcuts['undo']) {
      this.editor.redo();
    } else if (event.key === this.shortcuts['translate']) {
      this.editor.toolbar.setActiveTool('move');
    } else if (event.key === this.shortcuts['rotate']) {
      this.editor.toolbar.setActiveTool('rotate');
    } else if (event.key === this.shortcuts['scale']) {
      this.editor.toolbar.setActiveTool('scale');
    } else if (event.shiftKey && event.key.toLowerCase() === this.shortcuts['focus']) {
      this.signals.objectFocused.dispatch();
    } else if (event.key === 'Delete') {
      const object = this.selection.selectedObject;
      if (!object) return;
      this.editor.execute(new RemoveObjectCommand(this.editor, object));
    } else if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(true);
    } else if (event.key === 'f') {
      this.signals.createFaceFromVertices.dispatch();
    }
  }

  onKeyUp(event) {
    if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(false);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
  }
}