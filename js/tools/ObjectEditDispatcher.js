import * as THREE from 'three';
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";

export class ObjectEditDispatcher {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.controlsManager = editor.controlsManager;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectDeleted.add(() => {
      const object = this.selection.selectedObject;
      if (!object) return;
      this.editor.execute(new RemoveObjectCommand(this.editor, object));
    });

    this.signals.objectFocused.add(() => {
      const object = this.selection.selectedObject;
      if (object !== null && this.controlsManager?.focus) {
        this.controlsManager.focus(object);
      }
    });
  }
}