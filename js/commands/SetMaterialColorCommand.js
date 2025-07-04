import * as THREE from 'three';

export class SetMaterialColorCommand {
  static type = 'SetMaterialColorCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {string} attributeName
   * @param {number} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = 0xffffff) {
    this.editor = editor;
    this.name = `Set Material Color: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;

    const material = object?.material;
    this.oldValue = material ? material[attributeName].getHex() : null;
    this.newValue = newValue;
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !object.material) return;

    const material = object.material;

    material[this.attributeName].setHex(this.newValue);
    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !object.material) return;

    const material = object.material;

    material[this.attributeName].setHex(this.oldValue);
    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetMaterialColorCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetMaterialColorCommand.type) return null;

    const command = new SetMaterialColorCommand(editor, null, json.attributeName, json.newValue);

    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;

    return command;
  }
}
