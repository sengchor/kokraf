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
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;
      objects.forEach(obj => {
        this.editor.execute(new RemoveObjectCommand(this.editor, obj));
      })
    });

    this.signals.objectFocused.add(() => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;
      this.controlsManager.focus(objects);
    });
  }
}