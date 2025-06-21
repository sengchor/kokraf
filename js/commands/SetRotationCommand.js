export class SetRotationCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Euler|null} newRotation
   * @param {THREE.Euler|null} optionalOldRotation
   * @constructor
   */
  constructor(editor, object, newRotation, optionalOldRotation) {
    this.editor = editor;
    this.object = object;
    this.name = 'Set Rotation';

    this.oldRotation = optionalOldRotation ? optionalOldRotation.clone() : object.rotation.clone();
    this.newRotation = newRotation.clone();
  }

  execute() {
    this.object.rotation.copy(this.newRotation);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object.rotation.copy(this.oldRotation);
    this.object.updateMatrixWorld(true);
  }
}