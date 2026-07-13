import * as THREE from 'three';

export class SwitchPaintMapCommand {
  static type = 'SwitchPaintMapCommand';

  static MAP_LABELS = {
    map: 'Base Color',
    metalnessMap: 'Metalness',
    roughnessMap: 'Roughness',
    normalMap: 'Normal',
  };

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @param {string} newPaintMap
   * @param {string} previousPaintMap
   * @constructor
   */
  constructor(editor, object, newPaintMap, previousPaintMap) {
    this.editor = editor;
    this.objectUuid = object ? object.uuid : null;

    this.newPaintMap = newPaintMap;
    this.previousPaintMap = previousPaintMap;

    const label = SwitchPaintMapCommand.MAP_LABELS[this.newPaintMap] ?? this.newPaintMap;
    this.name = `Switch Paint Map (${label})`;
  }

  execute() {
    this._apply(this.newPaintMap);
  }

  undo() {
    this._apply(this.previousPaintMap);
  }

  _apply(paintMap) {
    if (!paintMap) return;

    const object = this.editor.objectByUuid(this.objectUuid);
    const texturePainter = this.editor.viewportControls?.texturePainter;

    if (texturePainter?.isActive && texturePainter.object === object) {
      texturePainter.setPaintMap(paintMap);
    }
  }

  toJSON() {
    return {
      type: SwitchPaintMapCommand.type,
      objectUuid: this.objectUuid,
      mode: this.newPaintMap,
      previousMode: this.previousPaintMap,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SwitchPaintMapCommand.type) return null;

    const command = new SwitchPaintMapCommand(editor, null, json.mode, json.previousMode);
    command.objectUuid = json.objectUuid;

    return command;
  }
}