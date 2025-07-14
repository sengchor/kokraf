import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";

export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.selectionHelper = editor.selectionHelper;
    this.shortcuts = null;
    
    this.init();
  }

  async init() {
    await this.config.loadSettings();
    this.shortcuts = this.config.get('shortcuts');

    this.onKeyDown = this.onKeyDown.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
  }

  onKeyDown(event) {
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
    } else if (event.key === this.shortcuts['focus']) {
      this.signals.objectFocused.dispatch();
    } else if (event.key === 'Delete') {
      const object = this.selectionHelper.selectedObject;
      this.editor.execute(new RemoveObjectCommand(this.editor, object));
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
  }
}