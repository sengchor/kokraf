import * as THREE from 'three';

import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";

export class MenubarEdit {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.selectionHelper = editor.selectionHelper;
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
      const object = this.selectionHelper.selectedObject;
      this.editor.execute(new SetPositionCommand(this.editor, object, newPos));
    });

    document.querySelector('.clone').addEventListener('click', () => {
      const object = this.selectionHelper.selectedObject;
      if (object) {
        const clone = object.clone(true);
        this.editor.execute(new AddObjectCommand(this.editor, clone));
      }
    });

    document.querySelector('.delete').addEventListener('click', () => {
      const object = this.selectionHelper.selectedObject;
      this.editor.execute(new RemoveObjectCommand(this.editor, object));
    });
  }
}