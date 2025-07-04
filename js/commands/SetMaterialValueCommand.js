import * as THREE from 'three';

export class SetMaterialValueCommand {
  static type = 'SetMaterialValueCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {string} attributeName
   * @param {any} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = null) {
    this.editor = editor;
    this.name = `Set Material Value: ${attributeName}`;
    
    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;
    
    const material = object?.material;
    this.oldValue = material?.[attributeName] ?? null;
    this.newValue = newValue;
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !object.material) return;

    const material = object.material;

    material[this.attributeName] = this.newValue;
    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !object.material) return;

    const material = object.material;

    material[this.attributeName] = this.oldValue;
    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetMaterialValueCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetMaterialValueCommand.type) return null;

    const command = new SetMaterialValueCommand(editor, null, json.attributeName, json.newValue);

    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;

    return command;
  }
}
