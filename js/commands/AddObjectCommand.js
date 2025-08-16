import * as THREE from 'three';

export class AddObjectCommand {
  static type = 'AddObjectCommand';
  
  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D} object 
   * @constructor
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Add Object: ' + object.name;
    this.object = object;
  }

  execute() {
    this.editor.sceneManager.addObject(this.object);
    this.editor.selection.select(this.object);
    this.editor.toolbar.updateTools();
  }

  undo() {
    this.object = this.editor.objectByUuid(this.object.uuid);
    this.editor.sceneManager.removeObject(this.object);
    this.editor.selection.deselect();
    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: AddObjectCommand.type,
      object: this.object.toJSON()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== AddObjectCommand.type) return null;

    let object = editor.objectByUuid(json.object.object.uuid);

    if ( object === undefined ) {
      const loader = new THREE.ObjectLoader();
      object = loader.parse(json.object);
    }
    return new AddObjectCommand(editor, object);
  }
}