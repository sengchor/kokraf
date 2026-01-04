import * as THREE from 'three';

import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { MultiCommand } from '../commands/MultiCommand.js';
import { duplicateObject } from '../utils/ObjectUtils.js';

export class MenubarEdit {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.selection = editor.selection;
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

      const multi = new MultiCommand(this.editor, 'Duplicate Objects');

      objects.forEach(object => {
        const duplicate = duplicateObject(object);
        multi.add(new AddObjectCommand(this.editor, duplicate));
      });

      this.editor.execute(multi);
    });

    document.querySelector('.delete').addEventListener('click', () => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const multi = new MultiCommand(this.editor, 'Delete Objects');

      objects.forEach(object => {
        multi.add(new RemoveObjectCommand(this.editor, object));
      });

      this.editor.execute(multi);
    });
  }
}