import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { SeparateSelectionCommand } from '../../commands/SeparateSelectionCommand.js';
import { SeamSnapshot } from '../../uv/SeamSnapshot.js';
import { SeamUtils } from '../../utils/SeamUtils.js';
import { resolveMeshTarget, resolveElementIds } from '../AgentUtils.js';

const DELETE_FN = {
  vertex: 'deleteSelectionVertices',
  edge: 'deleteSelectionEdges',
  face: 'deleteSelectionFaces',
};

const SELECTED_KEY = { vertex: 'selectedVertexIds', edge: 'selectedEdgeIds', face: 'selectedFaceIds' };
const SELECT_FN = { vertex: 'selectVertices', edge: 'selectEdges', face: 'selectFaces' };

export const editSeparateSpec = {
  description:
    'Move vertices, edges or faces out into a new object. ' +
    "ids: 'selected' requires the target to already be in Edit Mode. " +
    'Returns the new object uuid. Undoable.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    element: {
      type: 'string',
      enum: ['vertex', 'edge', 'face'],
      optional: true,
      description: "Element type. Defaults to the current select mode, else 'face'.",
    },
    ids: {
      anyOf: [
        { type: 'string', enum: ['selected'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected' or an array of element ids.",
    },
  },
  prepare({ target, element, ids }, editor) {
    const { object } = resolveMeshTarget(editor, target, 'edit.separate');

    const inEditMode = editor.editSelection.editedObject === object;
    const type = element ?? (inEditMode ? editor.editSelection.subSelectionMode : 'face');

    const elementIds = resolveElementIds(editor, object, ids, type, 'edit.separate');
    if (!elementIds.length) throw new Error(`edit.separate: no ${type}s to separate.`);

    return { modeTarget: object, object, type, ids, elementIds };
  },
  run(params, editor, { object, type, ids, elementIds }) {
    const meshData = object.userData.meshData;
    const { vertexEditor, meshEditor, editSelection } = editor;

    // After the mode switch, make the edit selection match the requested ids
    // so extraction and the derived vertex/edge/face sets behave exactly like the UI.
    if (ids !== 'selected') editSelection[SELECT_FN[type]](elementIds);

    const selected = {
      vertexIds: Array.from(editSelection.selectedVertexIds),
      edgeIds: Array.from(editSelection.selectedEdgeIds),
      faceIds: Array.from(editSelection.selectedFaceIds),
    };
    const typeIds = Array.from(editSelection[SELECTED_KEY[type]]);
    if (!typeIds.length) throw new Error(`edit.separate: no ${type}s selected after resolving ids.`);

    const { extracted: newMeshData, map } = meshEditor.extractMeshData(meshData, type, editSelection);
    if (!newMeshData?.vertices?.size) {
      throw new Error('edit.separate: nothing to separate.');
    }

    const beforeRegionIds = MeshDataRegion.expand(meshData, selected, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const beforeSeam = SeamSnapshot.read(object);

    vertexEditor.setObject(object);
    vertexEditor.delete[DELETE_FN[type]](typeIds);

    const { separated: newSeam, remaining: afterSeam } = SeamUtils.splitSeams(object, map.edgeIdMap, meshData);
    const seamData = { before: beforeSeam, after: afterSeam, separated: newSeam };

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    const scene = editor.sceneManager.mainScene;
    const existing = new Set();
    scene.traverse((o) => existing.add(o.uuid));

    editor.execute(new SeparateSelectionCommand(editor, object, beforeSnapshot, afterSnapshot, newMeshData, seamData));

    let created = null;
    scene.traverse((o) => {
      if (!created && !existing.has(o.uuid) && o.userData?.meshData) created = o;
    });

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      element: type,
      separatedCount: typeIds.length,
      newObject: created
        ? { uuid: created.uuid, name: created.name || '(unnamed)' }
        : null,
    };
  },
};