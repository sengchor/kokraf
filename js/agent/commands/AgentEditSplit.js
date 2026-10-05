import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { SplitSelectionCommand } from '../../commands/SplitSelectionCommand.js';
import { resolveMeshTarget, resolveElementIds } from '../AgentUtils.js';

const MAX_RETURNED_IDS = 256;

const DUPLICATE_FN = {
  vertex: 'duplicateSelectionVertices',
  edge: 'duplicateSelectionEdges',
  face: 'duplicateSelectionFaces',
};

const DELETE_FN = {
  vertex: 'deleteSelectionVertices',
  edge: 'deleteSelectionEdges',
  face: 'deleteSelectionFaces',
};

const REGION_KEY = { vertex: 'vertexIds', edge: 'edgeIds', face: 'faceIds' };
const NEW_IDS_KEY = { vertex: 'newVertexIds', edge: 'newEdgeIds', face: 'newFaceIds' };
const SELECT_FN = { vertex: 'selectVertices', edge: 'selectEdges', face: 'selectFaces' };

export const editSplitSpec = {
  description:
    'Detach vertices, edges or faces from the rest of the mesh (same object). ' +
    'Split parts become the selection. ' +
    "ids: 'selected' requires the target to already be in Edit Mode. Undoable.",
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
    const { object } = resolveMeshTarget(editor, target, 'edit.split');
    const { editSelection } = editor;

    const inEditMode = editSelection.editedObject === object;
    const type = element ?? (inEditMode ? editSelection.subSelectionMode : 'face');

    const elementIds = resolveElementIds(editor, object, ids, type, 'edit.split');
    if (!elementIds.length) throw new Error(`edit.split: no ${type}s to split.`);

    const region = ids === 'selected'
      ? {
          vertexIds: Array.from(editSelection.selectedVertexIds),
          edgeIds: Array.from(editSelection.selectedEdgeIds),
          faceIds: Array.from(editSelection.selectedFaceIds),
        }
      : { [REGION_KEY[type]]: elementIds };

    return { modeTarget: object, object, type, elementIds, region };
  },
  run(params, editor, { object, type, elementIds, region }) {
    const meshData = object.userData.meshData;
    const { vertexEditor } = editor;

    vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, region, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const result = vertexEditor.duplicate[DUPLICATE_FN[type]](elementIds) ?? {};
    const newIds = result[NEW_IDS_KEY[type]] ?? [];

    if (newIds.length) {
      vertexEditor.delete[DELETE_FN[type]](elementIds);
    }

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);

    if (!newIds.length) {
      vertexEditor.applyDelta(beforeSnapshot);
      throw new Error('edit.split: split produced no new elements.');
    }

    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new SplitSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

    editor.editSelection[SELECT_FN[type]](newIds);

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    const truncated = newIds.length > MAX_RETURNED_IDS;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      element: type,
      sourceCount: elementIds.length,
      newIds: truncated ? newIds.slice(0, MAX_RETURNED_IDS) : newIds,
      ...(truncated && { newIdsTruncated: true }),
    };
  },
};