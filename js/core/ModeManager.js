import { SwitchModeCommand } from '../commands/SwitchModeCommand.js';
import { TexturePainter } from '../texture/TexturePainter.js';
 
export const MODES = {
  object: { label: 'Object Mode',   requiresMesh: false },
  edit:   { label: 'Edit Mode',     requiresMesh: true },
  uv:     { label: 'UV Mode',       requiresMesh: true },
  paint:  { label: 'Texture Paint', requiresMesh: true },
};

export default class ModeManager {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.editHelpers = editor.editHelpers;
 
    this.currentMode = 'object';
    this.texturePainter = null;
    this.savedPaintMap = 'map';
 
    this._paintAttachToken = 0;
 
    this.signals.emptyScene.add(() => this.reset());
  }

  get paintMap() {
    return this.texturePainter?.paintMap || this.savedPaintMap;
  }

  setPaintMap(map) {
    this.savedPaintMap = map;
    if (this.texturePainter) {
      this.texturePainter.setPaintMap(map);
    }
  }

  isValidMesh(object) {
    return !!object?.isMesh && !object.userData?.isImageRef;
  }

  resolveTarget(newMode) {
    const def = MODES[newMode];

    if (this.currentMode === 'object' && def?.requiresMesh) {
      const selected = this.selection.selectedObjects;
      if (selected.length !== 1) {
        return { object: null, reason: `Please select one mesh to enter ${def.label}.` };
      }
      return { object: selected[0], reason: null };
    }

    return { object: this.editSelection.editedObject, reason: null };
  }

  canEnter(newMode) {
    const def = MODES[newMode];
    if (!def) {
      return { ok: false, object: null, reason: `Unknown mode: ${newMode}` };
    }

    const { object, reason } = this.resolveTarget(newMode);
    if (reason) {
      return { ok: false, object, reason };
    }

    if (def.requiresMesh && !this.isValidMesh(object)) {
      return { ok: false, object, reason: 'No mesh selected. Please select a mesh object.' };
    }

    return { ok: true, object, reason: null };
  }

  requestMode(newMode) {
    if (newMode === this.currentMode) {
      return { ok: true, object: this.editSelection.editedObject, reason: null };
    }

    const result = this.canEnter(newMode);
    if (!result.ok) {
      alert(result.reason);
      return result;
    }

    this.editor.execute(
      new SwitchModeCommand(this.editor, result.object, newMode, this.currentMode, this.paintMap)
    );

    return result;
  }

  switchTo(newMode, object = null) {
    const def = MODES[newMode];
    if (!def) throw new Error(`Unknown mode: ${newMode}`);

    if (!def.requiresMesh) {
      if (this.currentMode === newMode) return false;
      this.editor.execute(
        new SwitchModeCommand(this.editor, this.editSelection.editedObject, newMode, this.currentMode, this.paintMap)
      );
      return true;
    }

    if (!this.isValidMesh(object)) {
      const label = object ? object.name || object.uuid : 'nothing';
      throw new Error(`${def.label} needs a mesh, got ${label}.`);
    }

    if (this.currentMode === newMode && this.editSelection.editedObject === object) {
      return false;
    }

    this.editor.execute(
      new SwitchModeCommand(this.editor, object, newMode, this.currentMode, this.paintMap)
    );
    return true;
  }

  setMode(newMode, object = null, { paintMap = this.paintMap } = {}) {
    switch (newMode) {
      case 'edit':
        this._enterEdit(object);
        break;

      case 'uv':
        this._enterUV(object);
        break;

      case 'paint':
        this._enterPaint(object, paintMap);
        break;

      default:
        newMode = 'object';
        this._enterObject();
        break;
    }

    this.currentMode = newMode;
    this.signals.modeChanged.dispatch(newMode);
  }

  reset() {
    this.editSelection.setSubSelectionMode('vertex');
    this.signals.subSelectionModeChanged.dispatch('vertex');

    this.setPaintMap('map');
    this.setMode('object');
  }

  _removeEditHelpers() {
    if (this.editHelpers) {
      this.editHelpers.removeVertexPoints();
      this.editHelpers.removeEdgeLines();
    }
  }

  _detachPainter() {
    this._paintAttachToken++;
    if (this.texturePainter) {
      this.texturePainter.detach();
    }
  }

  _enterObject() {
    this.selection.enable = true;
    this.editSelection.enable = false;

    this._removeEditHelpers();

    const edited = this.editSelection.editedObject;
    if (edited) {
      this.editSelection.clearSelection();
      this.selection.select(edited);
      this.editSelection.editedObject = null;
    }

    this._detachPainter();
  }

  _enterEdit(object) {
    this._enterObjectEdit(object);
  }

  _enterUV(object) {
    this._enterObjectEdit(object);
  }

  _enterObjectEdit(object) {
    this.selection.enable = false;
    this.editSelection.enable = true;

    this.editSelection.editedObject = object;
    this.signals.editSelectionRefresh.dispatch();
    this.editSelection.clearSelection();
    this.selection.deselect();

    this._detachPainter();

    this.signals.objectSelected.dispatch([object]);
    this.signals.setEditObjectPanel.dispatch(object);
  }

  _enterPaint(object, paintMap = 'map') {
    this.selection.enable = false;
    this.editSelection.enable = false;

    this._removeEditHelpers();

    this.editSelection.editedObject = object;
    this.editSelection.clearSelection();
    this.selection.deselect();

    if (!this.texturePainter) {
      this.texturePainter = new TexturePainter(this.editor);
    }

    const token = ++this._paintAttachToken;
    const painter = this.texturePainter;

    painter.attach(object)
      .then(() => {
        if (token !== this._paintAttachToken) {
          if (this.currentMode !== 'paint') painter.detach();
          return;
        }

        if (paintMap && paintMap !== painter.paintMap) {
          painter.setPaintMap(paintMap);
        }
      })
      .catch((err) => {
        if (token !== this._paintAttachToken) return;

        alert(err.message);
        this.setMode('object');
      });

    this.signals.objectSelected.dispatch([object]);
    this.signals.setPaintObjectPanel.dispatch(object);
  }

  toJSON() {
    return {
      mode: this.currentMode,
      editedObjectUuid: this.editSelection.editedObject?.uuid || null,
      subSelectionMode: this.editSelection.subSelectionMode || 'vertex',
      paintMap: this.paintMap,
    };
  }

  fromJSON(json) {
    if (!json) {
      this.setMode('object');
      return;
    }

    const subMode = json.subSelectionMode || 'vertex';
    this.savedPaintMap = json.paintMap || 'map';

    this.editSelection.setSubSelectionMode(subMode);
    this.signals.subSelectionModeChanged.dispatch(subMode);

    const def = MODES[json.mode];
    const object = json.editedObjectUuid
      ? this.editor.objectByUuid(json.editedObjectUuid) : null;

    if (def?.requiresMesh && this.isValidMesh(object)) {
      this.selection.select(object);
      this.setMode(json.mode, object, { paintMap: this.savedPaintMap });
    } else {
      this.setMode('object');
    }
  }
}