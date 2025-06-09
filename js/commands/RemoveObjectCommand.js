export class RemoveObjectCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @constructor
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.object = object;
    this.parent = object.parent;
    this.helper = editor.helpers[object.id] || null;
    this.sceneManager = editor.sceneManager;
  }

  execute() {
    if (this.helper && this.helper.parent) {
      this.helper.parent.remove(this.helper);
      delete this.editor.helpers[this.object.id];
    }

    if (this.parent) {
      this.parent.remove(this.object);
    }

    this.editor.selectionHelper.deselect();
    this.editor.toolbar.updateTools();
  }

  undo() {
    if (this.parent) {
      this.parent.children.splice(this.index, 0, this.object);
      this.object.parent = this.parent;
    }

    if (this.helper) {
      this.sceneManager.sceneHelpers.add(this.helper);
      this.editor.helpers[this.object.id] = this.helper;
    }

    this.editor.selectionHelper.select(this.object);
    this.editor.toolbar.updateTools();
  }
}