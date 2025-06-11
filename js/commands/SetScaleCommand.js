export class SetScaleCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Euler|null} newScale
   * @param {THREE.Euler|null} optionalOldScale
   * @constructor
   */
  constructor(editor, object, newScale, optionalOldScale) {
    this.editor = editor;
    this.object = object;

    this.oldScale = optionalOldScale ? optionalOldScale.clone() : object.scale.clone();
    this.newScale = newScale.clone();
  }

  execute() {
    this.object.scale.copy(this.newScale);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object.scale.copy(this.oldScale);
    this.object.updateMatrixWorld(true);
  }
}