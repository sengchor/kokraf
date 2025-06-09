import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";

export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.selectionHelper = editor.selectionHelper;
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  onKeyDown(event) {
    if (event.ctrlKey && event.key === 'z') {
      this.editor.undo();
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') {
      this.editor.redo();
    } else if (event.key === 'Delete') {
      const object = this.selectionHelper.selectedObject;
      this.editor.execute(new RemoveObjectCommand(this.editor, object));
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
  }
}