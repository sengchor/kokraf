export class AddObjectCommand {
  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D} object 
   * @constructor
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.object = object;
  }

  execute() {
    this.editor.sceneManager.addObject(this.object);
    this.editor.selectionHelper.select(this.object);
    this.editor.toolbar.updateTools();
  }

  undo() {
    this.editor.sceneManager.removeObject(this.object);
    this.editor.selectionHelper.deselect();
    this.editor.toolbar.updateTools();
  }
}