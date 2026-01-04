import * as THREE from 'three';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { MultiCommand } from '../commands/MultiCommand.js';
import { duplicateObject } from '../utils/ObjectUtils.js';

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

      const multi = new MultiCommand(this.editor, 'Delete Objects');

      objects.forEach(object => {
        multi.add(new RemoveObjectCommand(this.editor, object));
      });

      this.editor.execute(multi);
    });

    this.signals.objectFocused.add(() => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;
      this.controlsManager.focus(objects);
    });

    this.signals.objectDuplicated.add(() => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const multi = new MultiCommand(this.editor, 'Duplicate Objects');

      objects.forEach(object => {
        const duplicate = duplicateObject(object);
        multi.add(new AddObjectCommand(this.editor, duplicate));
      });

      this.editor.execute(multi);
    });
  }
}