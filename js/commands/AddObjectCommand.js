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
    this.editor.selectionHelper.select(this.object);
    this.editor.toolbar.updateTools();
  }

  undo() {
    this.object = this.editor.objectByUuid(this.object.uuid);
    this.editor.sceneManager.removeObject(this.object);
    this.editor.selectionHelper.deselect();
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

    let obj = editor.objectByUuid(json.object.object.uuid);

    if ( obj === undefined ) {
      const loader = new THREE.ObjectLoader();
      obj = loader.parse(json.object);
    }
    return new AddObjectCommand(editor, obj);
  }
}