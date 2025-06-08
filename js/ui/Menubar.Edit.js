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
      this.centerObject();
    });

    document.querySelector('.clone').addEventListener('click', () => {
      this.cloneObject();
    });

    document.querySelector('.delete').addEventListener('click', () => {
      this.editor.deleteObject();
    });
  }

  centerObject() {
    const object = this.selectionHelper.selectedObject;
    if (object) {
      object.position.set(0, 0, 0);
    }
  }

  cloneObject() {
    const object = this.selectionHelper.selectedObject;
    if (object) {
      const clone = object.clone(true);
      this.sceneManager.addObject(clone);
    }
  }
}