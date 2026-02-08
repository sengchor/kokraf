import * as THREE from 'three';

export class SetOriginToGeometryCommand {
  static type = 'SetOriginToGeometryCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Set Origin To Geometry';
    this.meshEditor = editor.meshEditor;
    this.vertexEditor = editor.vertexEditor;

    if (object) {
      this.objectUuid = object.uuid;
      this.centerOffset = null;
    }
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    if (!this.centerOffset) {
      this.centerOffset = this.meshEditor.setOriginToGeometry(meshData).clone();
    } else {
      for (const v of meshData.vertices.values()) {
        v.position.x -= this.centerOffset.x;
        v.position.y -= this.centerOffset.y;
        v.position.z -= this.centerOffset.z;
      }
    }

    const worldOffset = this.localOffsetToWorld(object, this.centerOffset);
    object.position.add(worldOffset);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object.userData.meshData;

    for (const v of meshData.vertices.values()) {
      v.position.x += this.centerOffset.x;
      v.position.y += this.centerOffset.y;
      v.position.z += this.centerOffset.z;
    }

    const worldOffset = this.localOffsetToWorld(object, this.centerOffset);
    object.position.sub(worldOffset);
    object.updateMatrixWorld(true);

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.editor.toolbar.updateTools();
  }

  localOffsetToWorld(object, localOffset) {
    const m = new THREE.Matrix4();
    m.copy(object.matrixWorld);
    m.setPosition(0, 0, 0);
    return localOffset.clone().applyMatrix4(m);
  }

  toJSON() {
    return {
      type: SetOriginToGeometryCommand.type,
      objectUuid: this.objectUuid,
      centerOffset: this.centerOffset.toArray(),
    };
  }

  static fromJSON(editor, json) {
    const cmd = new SetOriginToGeometryCommand(editor);

    cmd.objectUuid = json.objectUuid;
    cmd.centerOffset = new THREE.Vector3().fromArray(json.centerOffset);

    return cmd;
  }
}