import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { MergeSelectionCommand } from '../../commands/MergeSelectionCommand.js';
import { resolveMeshTarget, resolveVertexIds } from '../AgentUtils.js';

const MAX_RETURNED_IDS = 256;

export const editMergeSpec = {
  description:
    "Merge vertices. at:'distance' welds vertices closer than threshold (local units); " +
    'other modes collapse all given vertices into one. ' +
    "vertices: 'selected' requires the target to already be in Edit Mode. Undoable.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    vertices: {
      anyOf: [
        { type: 'string', enum: ['selected', 'all'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected', 'all', or an array of vertex ids.",
    },
    at: {
      type: 'string',
      enum: ['center', 'first', 'last', 'cursor', 'distance'], // TODO: match your merge-at-* modes
      default: 'center',
      description: 'Merge mode.',
    },
    threshold: { type: 'number', default: 0.001, description: "Only for at:'distance'." },
  },
  prepare({ target, vertices, at = 'center', threshold = 0.001 }, editor) {
    const { object } = resolveMeshTarget(editor, target, 'edit.merge');

    const vertexIds = resolveVertexIds(editor, object, vertices, 'edit.merge');
    if (vertexIds.length < 2) throw new Error('edit.merge: need at least 2 vertices.');

    if (at === 'distance' && !(threshold > 0)) {
      throw new Error('edit.merge: threshold must be > 0.');
    }

    return { modeTarget: object, object, vertexIds };
  },
  run({ at = 'center', threshold = 0.001 }, editor, { object, vertexIds }) {
    const meshData = object.userData.meshData;
    const { vertexEditor } = editor;

    vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { vertexIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    let targetIds;
    if (at === 'distance') {
      targetIds = vertexEditor.topology.mergeByDistance(vertexIds, threshold) ?? [];
    } else {
      const id = vertexEditor.topology.mergeVertices(vertexIds, at);
      targetIds = id != null ? [id] : [];
    }

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);

    const removed = vertexIds.length - targetIds.length;
    if (removed <= 0) {
      vertexEditor.applyDelta(beforeSnapshot);
      return {
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        at,
        removed: 0,
      };
    }

    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new MergeSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

    editor.editSelection.selectVertices(targetIds);

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    const truncated = targetIds.length > MAX_RETURNED_IDS;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      at,
      removed,
      resultVertexIds: truncated ? targetIds.slice(0, MAX_RETURNED_IDS) : targetIds,
      ...(truncated && { resultVertexIdsTruncated: true }),
    };
  },
};