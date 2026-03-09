import * as THREE from 'three';

export class ApplyScaleCommand {
  static type = 'ApplyScaleCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Apply Scale';

    this.signals = editor.signals;
    this.meshEditor = editor.meshEditor;
    this.vertexEditor = editor.vertexEditor;

    if (object) {
      this.objectUuid = object.uuid;
      this.scale = object.scale.clone();
    }
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    this.meshEditor.applyScaleToGeometry(meshData, this.scale);

    object.scale.set(1, 1, 1);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
    this.signals.objectChanged.dispatch();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    const inverseScale = new THREE.Vector3(
      1 / this.scale.x,
      1 / this.scale.y,
      1 / this.scale.z
    );

    this.meshEditor.applyScaleToGeometry(meshData, inverseScale);

    object.scale.copy(this.scale);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
    this.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: ApplyScaleCommand.type,
      objectUuid: this.objectUuid,
      scale: this.scale.toArray()
    };
  }

  static fromJSON(editor, json) {
    const cmd = new ApplyScaleCommand(editor);

    cmd.objectUuid = json.objectUuid;
    cmd.scale = new THREE.Vector3().fromArray(json.scale);

    return cmd;
  }
}