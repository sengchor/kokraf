import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { DuplicateSelectionCommand } from '../../commands/DuplicateSelectionCommand.js';
import { resolveMeshTarget, resolveElementIds } from '../AgentUtils.js';

const MAX_RETURNED_IDS = 256;

const DUPLICATE_FN = {
  vertex: 'duplicateSelectionVertices',
  edge: 'duplicateSelectionEdges',
  face: 'duplicateSelectionFaces',
};

const REGION_KEY = { vertex: 'vertexIds', edge: 'edgeIds', face: 'faceIds' };
const NEW_IDS_KEY = { vertex: 'newVertexIds', edge: 'newEdgeIds', face: 'newFaceIds' };
const SELECT_FN = { vertex: 'selectVertices', edge: 'selectEdges', face: 'selectFaces' };

export const editDuplicateSpec = {
  description:
    'Duplicate vertices, edges or faces in place. Copies become the selection; ' +
    "move them with edit.transform vertices:'selected'. " +
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
        { type: 'string', enum: ['selected', 'all'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected', 'all', or an array of element ids.",
    },
  },
  prepare({ target, element, ids }, editor) {
    const { object } = resolveMeshTarget(editor, target, 'edit.duplicate');

    const inEditMode = editor.editSelection.editedObject === object;
    const type = element ?? (inEditMode ? editor.editSelection.subSelectionMode : 'face');

    const elementIds = resolveElementIds(editor, object, ids, type, 'edit.duplicate');
    if (!elementIds.length) throw new Error(`edit.duplicate: no ${type}s to duplicate.`);

    return { modeTarget: object, object, type, elementIds };
  },
  run(params, editor, { object, type, elementIds }) {
    const meshData = object.userData.meshData;

    editor.vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { [REGION_KEY[type]]: elementIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const result = editor.vertexEditor.duplicate[DUPLICATE_FN[type]](elementIds) ?? {};
    const newIds = result[NEW_IDS_KEY[type]] ?? [];

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);

    if (!newIds.length) {
      editor.vertexEditor.applyDelta(beforeSnapshot);
      throw new Error('edit.duplicate: duplication produced no new elements.');
    }

    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new DuplicateSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

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
      newVertexCount: result.newVertexIds?.length ?? 0,
    };
  },
};