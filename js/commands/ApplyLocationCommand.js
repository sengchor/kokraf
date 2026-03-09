import * as THREE from 'three';

export class ApplyLocationCommand {
  static type = 'ApplyLocationCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Apply Location';
    
    this.signals = editor.signals;
    this.meshEditor = editor.meshEditor;
    this.vertexEditor = editor.vertexEditor;

    if (object) {
      this.objectUuid = object.uuid;
      this.offset = object.position.clone();
    }
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    this.meshEditor.applyLocationToGeometry(meshData, this.offset);

    object.position.sub(this.offset);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
    this.signals.objectChanged.dispatch();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    this.meshEditor.applyLocationToGeometry(meshData, this.offset.clone().negate());

    object.position.add(this.offset);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
    this.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: ApplyLocationCommand.type,
      objectUuid: this.objectUuid,
      offset: this.offset.toArray()
    };
  }

  static fromJSON(editor, json) {
    const cmd = new ApplyLocationCommand(editor);

    cmd.objectUuid = json.objectUuid;
    cmd.offset = new THREE.Vector3().fromArray(json.offset);

    return cmd;
  }
}