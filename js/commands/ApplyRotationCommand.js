import * as THREE from 'three';

export class ApplyRotationCommand {
  static type = 'ApplyRotationCommand';

  /**
   * @param {Editor} edtior
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Apply Rotation';
    
    this.meshEditor = editor.meshEditor;
    this.vertexEditor = editor.vertexEditor;

    if (object) {
      this.objectUuid = object.uuid;
      this.quaternion = object.quaternion.clone();
    }
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    this.meshEditor.applyRotationToGeometry(meshData, this.quaternion);

    object.quaternion.multiply(this.quaternion.clone().invert());
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    this.meshEditor.applyRotationToGeometry(meshData, this.quaternion.clone().invert());

    object.quaternion.multiply(this.quaternion);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: ApplyRotationCommand.type,
      objectUuid: this.objectUuid,
      quaternion: this.quaternion.toArray()
    };
  }

  static fromJSON(editor, json) {
    const cmd = new ApplyRotationCommand(editor);

    cmd.objectUuid = json.objectUuid;
    cmd.quaternion = new THREE.Quaternion().fromArray(json.quaternion);

    return cmd;
  }
}