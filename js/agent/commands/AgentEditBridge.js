import { BridgeSelectionCommand } from '../../commands/BridgeSelectionCommand.js';
import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { resolveMeshTarget, resolveEdgeIds, meshStats } from '../AgentUtils.js';

function deriveSelection(meshData, edgeIds) {
  const edgeSet = new Set(edgeIds);
  const vertexSet = new Set();
  const candidateFaceIds = new Set();

  for (const id of edgeIds) {
    const edge = meshData.edges.get(id);
    vertexSet.add(edge.v1Id);
    vertexSet.add(edge.v2Id);
    for (const faceId of edge.faceIds) candidateFaceIds.add(faceId);
  }

  const faceIds = [];
  for (const faceId of candidateFaceIds) {
    const face = meshData.faces.get(faceId);
    let covered = true;
    for (const e of face.edgeIds) {
      if (!edgeSet.has(e)) { covered = false; break; }
    }
    if (covered) faceIds.push(faceId);
  }

  return { vertexIds: [...vertexSet], faceIds };
}

export const editBridgeSpec = {
  description:
    'Bridge two edge loops with faces. ' +
    "edges: 'selected' requires the target to already be in Edit Mode; otherwise pass the ids of both loops. " +
    'New vertices become the selection. Undoable.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    edges: {
      anyOf: [
        { type: 'string', enum: ['selected'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected' or edge ids of both loops.",
    },
    numCuts: { type: 'integer', default: 0, description: '0-50.' },
    smoothness: { type: 'number', default: 1, description: '0-1.' },
    twist: { type: 'integer', default: 0, description: '-50 to 50.' },
  },
  prepare({ target, edges }, editor) {
    const { object, meshData } = resolveMeshTarget(editor, target, 'edit.bridge');

    const edgeIds = resolveEdgeIds(editor, object, edges, 'edit.bridge');
    if (edgeIds.length < 2) throw new Error('edit.bridge: need edges from two loops.');

    const { vertexIds, faceIds } = edges === 'selected'
      ? {
          vertexIds: Array.from(editor.editSelection.selectedVertexIds),
          faceIds: Array.from(editor.editSelection.selectedFaceIds),
        }
      : deriveSelection(meshData, edgeIds);

    return { modeTarget: object, object, vertexIds, edgeIds, faceIds };
  },
  run({ numCuts = 0, smoothness = 1, twist = 0 }, editor, { object, vertexIds, edgeIds, faceIds }) {
    const meshData = object.userData.meshData;
    const { vertexEditor } = editor;
    const before = meshStats(object);

    const params = {
      numCuts: Math.max(0, Math.min(50, Math.round(numCuts))),
      smoothness: Math.max(0, Math.min(1, smoothness)),
      twist: Math.max(-50, Math.min(50, Math.round(twist))),
    };

    vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { edgeIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const result = vertexEditor.bridge.bridgeEdgeLoops(vertexIds, edgeIds, faceIds, params);

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);

    if (!result?.success) {
      vertexEditor.applyDelta(beforeSnapshot);
      throw new Error('edit.bridge: bridge failed. Edges must form two separate loops.');
    }

    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new BridgeSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

    editor.editSelection.selectVertices(result.newVertexIds ?? []);
    editor.signals.editSelectionRefresh.dispatch();

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    const after = meshStats(object);

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      ...params,
      newVertexCount: result.newVertexIds?.length ?? 0,
      faceDelta: after.faces - before.faces,
    };
  },
};