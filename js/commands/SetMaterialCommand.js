import * as THREE from 'three';

export class SetMaterialCommand {
  static type = 'SetMaterialCommand';

  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D} object 
   * @param {THREE.Material} newMaterial
   * @constructor
   */
  constructor(editor, object, newMaterial) {
    this.editor = editor;
    this.name = 'Set Object Material';
    if (!object) return;

    this.objectUuid = object.uuid;
    this.oldMaterial = object.material;
    this.newMaterial = newMaterial;
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    object.material = this.newMaterial;
    object.material.needsUpdate = true;
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    object.material = this.oldMaterial;
    object.material.needsUpdate = true;
  }

  toJSON() {
    const meta = {
      textures: {},
      images: {},
    };

    const oldMaterialJSON = this.oldMaterial.toJSON(meta);
    const newMaterialJSON = this.newMaterial.toJSON(meta);

    return {
      type: SetMaterialCommand.type,
      objectUuid: this.objectUuid,

      oldMaterial: oldMaterialJSON,
      newMaterial: newMaterialJSON,

      textures: Object.values(meta.textures),
      images: Object.values(meta.images),
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetMaterialCommand.type) return null;

    const loader = new THREE.ObjectLoader();

    const images = loader.parseImages(json.images || []);
    const textures = loader.parseTextures(
      json.textures || [],
      images
    );

    const oldMaterial = loader.parseMaterials(
      [json.oldMaterial],
      textures
    )[json.oldMaterial.uuid];

    const newMaterial = loader.parseMaterials(
      [json.newMaterial],
      textures
    )[json.newMaterial.uuid];

    const command = new SetMaterialCommand(editor);
    command.objectUuid = json.objectUuid;
    command.oldMaterial = oldMaterial;
    command.newMaterial = newMaterial;

    return command;
  }
}