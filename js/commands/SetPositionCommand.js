export class SetPositionCommand {
  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D|null} object 
   * @param {THREE.Vector3|null} newPosition 
   * @param {THREE.Vector3|null} optionalOldPosition
   * @constructor 
   */
  constructor(editor, object, newPosition, optionalOldPosition) {
    this.editor = editor;
    this.object = object;

    this.oldPosition = optionalOldPosition ? optionalOldPosition.clone() : object.position.clone();
    this.newPosition = newPosition.clone();
  }

  execute() {
    this.object.position.copy(this.newPosition);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object.position.copy(this.oldPosition);
    this.object.updateMatrixWorld(true);
  }
}