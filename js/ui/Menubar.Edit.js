import * as THREE from 'three';

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
  }
}