import * as THREE from 'three';

import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';
import { DuplicateObjectCommand } from '../commands/DuplicateObjectCommand.js';

export class MenubarEdit {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.selection = editor.selection;
    this.objectEditor = editor.objectEditor;
    this.init();
  }

  init() {
    document.querySelector('.undo').addEventListener('click', () => {
      this.editor.undo();
    });

    document.querySelector('.redo').addEventListener('click', () => {
      this.editor.redo();
    });

    document.querySelector('.center').addEventListener('click', () => {
      const newPos = new THREE.Vector3(0, 0, 0);
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const oldPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      const newPositions = objects.map(() => newPos.clone());

      this.editor.execute(new SetPositionCommand(this.editor, objects, newPositions, oldPositions));
    });

    document.querySelector('.duplicate').addEventListener('click', () => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const duplicates = this.objectEditor.duplicateObjects(objects);

      this.editor.execute(new DuplicateObjectCommand(this.editor, objects, duplicates));
    });

    document.querySelector('.delete').addEventListener('click', () => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const multi = new SequentialMultiCommand(this.editor, 'Delete Objects');

      for (const object of objects) {
        multi.add(() => new RemoveObjectCommand(this.editor, object));
      }

      this.editor.execute(multi);
    });
  }
}