import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { SubdivideSelectionCommand } from '../../commands/SubdivideSelectionCommand.js';
import { resolveMeshTarget, resolveEdgeIds, meshStats } from '../AgentUtils.js';

const MAX_RETURNED_IDS = 256;

export const editSubdivideSpec = {
  description:
    'Split edges at their midpoint, adding a vertex to each. ' +
    "edges: 'selected' requires the target to already be in Edit Mode; otherwise pass 'all' or ids. " +
    'New vertices become the selection. Undoable.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    edges: {
      anyOf: [
        { type: 'string', enum: ['selected', 'all'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description:
        "'selected' (current edit selection; the target must already be in Edit Mode), 'all', or an array of edge ids.",
    },
  },
  prepare({ target, edges }, editor) {
    const { object } = resolveMeshTarget(editor, target, 'edit.subdivide');

    const edgeIds = resolveEdgeIds(editor, object, edges, 'edit.subdivide');
    if (!edgeIds.length) throw new Error('edit.subdivide: no edges to subdivide.');

    return { modeTarget: object, object, edgeIds };
  },
  run(params, editor, { object, edgeIds }) {
    const meshData = object.userData.meshData;
    const before = meshStats(object);

    editor.vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { edgeIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const { newVertexIds = [] } = editor.vertexEditor.subdivide.subdivideEdges(edgeIds) ?? {};

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);

    if (!newVertexIds.length) {
      // Nothing was produced: roll back any partial changes so no undo step is recorded.
      editor.vertexEditor.applyDelta(beforeSnapshot);
      throw new Error('edit.subdivide: subdivision produced no new vertices.');
    }

    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new SubdivideSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

    editor.editSelection.selectVertices(newVertexIds);

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    const after = meshStats(object);
    const truncated = newVertexIds.length > MAX_RETURNED_IDS;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      edgeCount: edgeIds.length,
      newVertexCount: newVertexIds.length,
      newVertexIds: truncated ? newVertexIds.slice(0, MAX_RETURNED_IDS) : newVertexIds,
      ...(truncated && { newVertexIdsTruncated: true }),
      before,
      after,
    };
  },
};