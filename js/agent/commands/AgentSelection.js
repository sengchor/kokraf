import * as THREE from 'three';
import { AXES_NOTE, RAD, positionToThree, positionFromThree } from '../AgentAxes.js';
import { resolveMeshTarget, elementsOf, vertexIdsOf, worldPositionLookup, faceNormal } from '../AgentUtils.js';
import { SwitchSubModeCommand } from '../../commands/SwitchSubModeCommand.js';

const ID_SAMPLE = 50;

const fail = (msg) => {
  throw new Error(`edit.select: ${msg}`);
};

function applySelection(selection, selectMode, ids) {
  if (!ids.length) {
    selection.clearSelection();
    return;
  }

  const previousMulti = selection.multiSelectEnabled;
  selection.multiSelectEnabled = false;
  try {
    if (selectMode === 'vertex') selection.selectVertices(ids);
    else if (selectMode === 'edge') selection.selectEdges(ids);
    else selection.selectFaces(ids);
  } finally {
    selection.multiSelectEnabled = previousMulti;
  }
}

export const editSelectSpec = {
  description:
    AXES_NOTE +
    'Select vertices, edges or faces of one mesh, entering Edit Mode on it. ' +
    'Filter by ids and/or (faces only) a facing direction; when both are given, both must hold. ' +
    'Vertices of selected edges/faces are selected too, so edit.transform with vertices "selected" moves the result. ' +
    'Pass ids: [] to clear the selection.',
  mutates: false,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    selectMode: {
      type: 'string',
      enum: ['vertex', 'edge', 'face'],
      default: 'vertex',
      description: 'Element type to select; also switches the editor selection mode.',
    },
    op: {
      type: 'string',
      enum: ['set', 'add', 'subtract'],
      default: 'set',
      description: 'Replace the current selection, add to it, or remove from it.',
    },
    ids: { type: 'number[]', optional: true, description: 'Element ids of the selectMode type.' },
    facing: {
      type: 'vec3',
      optional: true,
      description: 'Faces only: select faces whose normal points this way, e.g. [0, 0, 1] for up.',
    },
    angle: { type: 'number', default: 10, description: 'Degrees of tolerance for facing.' },
  },

  prepare({ target, selectMode, ids, facing }, editor) {
    const { object, meshData } = resolveMeshTarget(editor, target, 'edit.select');

    if (ids === undefined && facing === undefined) {
      fail('supply ids and/or facing. To clear the selection, pass ids: [].');
    }
    if (facing !== undefined && selectMode !== 'face') fail('facing only works with selectMode "face".');

    if (ids !== undefined) {
      const elements = elementsOf(meshData, selectMode);
      const missing = ids.filter((id) => !elements.has(id));
      if (missing.length) fail(`no ${selectMode} with id ${missing.slice(0, 10).join(', ')}.`);
    }

    let facingDir = null;
    if (facing !== undefined) {
      facingDir = new THREE.Vector3(...positionToThree(facing));
      if (facingDir.lengthSq() === 0) fail('facing must not be [0, 0, 0].');
      facingDir.normalize();
    }

    return { modeTarget: object, object, facingDir };
  },

  run({ selectMode, op, ids, angle }, editor, { object, facingDir }) {
    const selection = editor.editSelection;
    if (selection.editedObject !== object) fail(`could not enter Edit Mode on "${object.name || object.uuid}".`);

    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const meshData = object.userData.meshData;
    const worldPos = worldPositionLookup(object, meshData);
    const minDot = Math.cos(angle * RAD);
    const idSet = ids ? new Set(ids) : null;

    const matched = [];
    for (const element of elementsOf(meshData, selectMode).values()) {
      if (idSet && !idSet.has(element.id))continue;
      if (facingDir && faceNormal(object, vertexIdsOf(element, selectMode), worldPos).dot(facingDir) < minDot) continue;
      matched.push(element.id);
    }

    if (selection.subSelectionMode !== selectMode) {
      editor.execute(new SwitchSubModeCommand(editor, selectMode, selection.subSelectionMode));
    }

    const current = {
      vertex: selection.selectedVertexIds,
      edge: selection.selectedEdgeIds,
      face: selection.selectedFaceIds,
    }[selectMode];

    const next = op === 'set' ? new Set(matched) : new Set(current);
    if (op === 'add') matched.forEach((id) => next.add(id));
    if (op === 'subtract') matched.forEach((id) => next.delete(id));

    applySelection(selection, selectMode, [...next]);

    let bounds = null;
    if (selection.selectedVertexIds.size) {
      const b = new THREE.Box3();
      for (const id of selection.selectedVertexIds) b.expandByPoint(worldPos(id));
      bounds = { min: positionFromThree(b.min), max: positionFromThree(b.max) };
    }

    const selectedIds = [...next].sort((a, b) => a - b);

    return {
      uuid: object.uuid,
      name: object.name || 'unnamed',
      selectMode,
      matched: matched.length,
      selected: {
        vertices: selection.selectedVertexIds.size,
        edges: selection.selectedEdgeIds.size,
        faces: selection.selectedFaceIds.size,
      },
      ids: selectedIds.slice(0, ID_SAMPLE),
      idsTruncated: selectedIds.length > ID_SAMPLE,
      bounds,
    };
  }
};