import * as THREE from 'three';

export class RemoveObjectCommand {
  static type = 'RemoveObjectCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @constructor
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Remove Object: ' + object.name;
    this.object = object;

    this.parent = ( object !== null ) ? object.parent : null;
    if ( this.parent !== null ) {
			this.index = this.parent.children.indexOf(this.object);
		}
  }

  execute() {
    this.object = this.editor.objectByUuid(this.object.uuid);
    this.editor.sceneManager.removeObject(this.object);
    this.editor.selectionHelper.deselect();
    this.editor.toolbar.updateTools();
  }

  undo() {
    this.editor.sceneManager.addObject(this.object, this.parent, this.index);
    this.editor.selectionHelper.select(this.object);
    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: RemoveObjectCommand.type,
      object: this.object.toJSON(),
      parentUuid: this.parent?.uuid || null,
      index: this.index
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== RemoveObjectCommand.type) return null;

    let obj = editor.objectByUuid(json.object.object.uuid);

    if ( obj === undefined ) {
      const loader = new THREE.ObjectLoader();
      obj = loader.parse(json.object);
    }

    const cmd = new RemoveObjectCommand(editor, obj);
    cmd.index = json.index;
    cmd.parent = editor.objectByUuid(json.parentUuid);

    return cmd;
  }
}