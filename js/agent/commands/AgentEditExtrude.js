import * as THREE from 'three';
import { ExtrudeOps } from '../../operations/ExtrudeOps.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionToThree, positionFromThree } from '../AgentAxes.js';

const SELECTION_KEY = { vertex: 'vertexIds', edge: 'edgeIds', face: 'faceIds' };

export const editExtrudeSpec = {
  description:
    AXES_NOTE +
    'Extrude the current edit selection of a mesh: duplicates the selected vertices/edges/faces, ' +
    'bridges them to the originals with side faces, and offsets the new geometry. ' +
    'Operates on the CURRENT edit selection and selection mode, so call edit.select on the same target first. ' +
    "In face mode, 'distance' moves along the selection's average normal (negative = inward). " +
    "In any mode, 'translate' moves by a vector. Omit both to extrude in place. " +
    "Afterwards the new elements are selected, so a following edit.transform with " +
    "vertices: 'selected' reshapes them. Undoable as one step.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of the mesh object currently in Edit Mode.' },
    distance: {
      type: 'number',
      optional: true,
      description: 'Face mode only: offset in metres along the average face normal. Exclusive with translate.',
    },
    translate: {
      type: 'vec3',
      optional: true,
      description: '[x, y, z] offset in metres.Exclusive with distance.',
    },
    space: {
      type: 'string',
      enum: ['world', 'local'],
      default: 'world',
      description: "Axes for translate. 'local' uses the object's orientation.",
    },
  },

  prepare({ target, distance, translate }, editor) {
    if (distance !== undefined && translate !== undefined) {
      throw new Error('edit.extrude: pass distance or translate, not both.');
    }

    const objects = resolveTargets(editor, target);
    if (objects.length !== 1) throw new Error('edit.extrude: target must resolve to exactly one object.');
    const object = objects[0];
    const label = object.name || object.uuid;

    if (!editor.modeManager.isValidMesh(object)) {
      throw new Error(`edit.extrude: "${label}" is not an editable mesh.`);
    }

    const { editSelection, modeManager } = editor;
    if (modeManager.currentMode !== 'edit' || editSelection.editedObject !== object) {
      throw new Error(`edit.extrude: "${label}" is not in Edit Mode. Call edit.select on it first.`);
    }

    const mode = editSelection.subSelectionMode;
    const key = SELECTION_KEY[mode];
    if (!key) throw new Error(`edit.extrude: unsupported selection mode "${mode}".`);

    const selection = ExtrudeOps.readSelection(editSelection);
    if (!selection[key].length) {
      throw new Error(`edit.extrude: no ${mode}s selected on "${label}".`);
    }
    if (distance !== undefined && mode !== 'face') {
      throw new Error(`edit.extrude: distance needs face mode (current: ${mode}). Use translate instead.`);
    }

    return { modeTarget: object, object, selectionMode: mode, selection };
  },

  run({ distance, translate, space }, editor, { object, selectionMode, selection }) {
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const meshData = object.userData.meshData;
    const vertexEditor = editor.vertexEditor;

    const offset = new THREE.Vector3();
    let normal = null;

    if (distance !== undefined) {
      const orientation = ExtrudeOps.computeFaceNormalOrientation(object, selection.faceIds);
      if (!orientation) throw new Error('edit.extrude: could not compute a normal for the selected faces.');
      normal = orientation.worldNormal;
      offset.copy(normal).multiplyScalar(distance);
    } else if (translate !== undefined) {
      offset.copy(positionToThree(translate));
      if (space === 'local') offset.applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
    }

    vertexEditor.setObject(object);
    const extrusion = ExtrudeOps.buildExtrusion(vertexEditor, meshData, selectionMode, selection);
    if (!extrusion) throw new Error(`edit.extrude: could not extrude in ${selectionMode} mode.`);

    if (offset.lengthSq() > 0) {
      const positions = extrusion.initialPositions.map((p) => p.clone().add(offset));
      vertexEditor.transform.setVertexPositions(extrusion.newVertexIds, positions);
    }

    editor.add(ExtrudeOps.createCommand(editor, object, extrusion));

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    ExtrudeOps.selectExtruded(editor.editSelection, selectionMode, extrusion);
    editor.signals.editSelectionRefresh.dispatch();
    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      selectionMode,
      created: {
        vertices: extrusion.newVertexIds.length,
        edges: extrusion.newEdgeIds.length,
        faces: extrusion.newFaceIds.length,
      },
      offset: positionFromThree(offset),
      normal: normal ? positionFromThree(normal) : null,
      selected: `new ${selectionMode}s`,
    };
  },
};