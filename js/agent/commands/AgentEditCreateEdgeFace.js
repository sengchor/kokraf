import { getSortedVertexIds } from '../../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../../utils/AlignedNormalUtils.js';
import { CreateFaceCommand } from '../../commands/CreateFaceCommand.js';
import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { resolveMeshTarget, resolveVertexIds } from '../AgentUtils.js';

function edgesAmong(meshData, vertexIds) {
  const set = new Set(vertexIds);
  const ids = [];
  for (const [id, edge] of meshData.edges) {
    if (set.has(edge.v1Id) && set.has(edge.v2Id)) ids.push(id);
  }
  return ids;
}

export const editCreateEdgeFaceSpec = {
  description:
    'Fill vertices: 2 -> edge, 3+ -> face (auto-ordered, normal matched to neighbors), ' +
    '1 -> adds a vertex completing a quad with its open edges. ' +
    "vertices: 'selected' requires the target to already be in Edit Mode. Undoable.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    vertices: {
      anyOf: [
        { type: 'string', enum: ['selected'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected' or an array of vertex ids.",
    },
  },
  prepare({ target, vertices }, editor) {
    const { object, meshData } = resolveMeshTarget(editor, target, 'edit.createEdgeFace');

    const vertexIds = resolveVertexIds(editor, object, vertices, 'edit.createEdgeFace');
    if (!vertexIds.length) throw new Error('edit.createEdgeFace: no vertices given.');

    if (vertexIds.length >= 3 && meshData.getFace(vertexIds)) {
      throw new Error('edit.createEdgeFace: a face with these vertices already exists.');
    }

    const edgeIds = vertices === 'selected'
      ? Array.from(editor.editSelection.selectedEdgeIds)
      : edgesAmong(meshData, vertexIds);

    return { modeTarget: object, object, vertexIds, edgeIds };
  },
  run(params, editor, { object, vertexIds, edgeIds }) {
    const meshData = object.userData.meshData;
    const { vertexEditor, editSelection } = editor;

    vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { vertexIds, edgeIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const fail = (message) => {
      MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
      vertexEditor.applyDelta(beforeSnapshot);
      throw new Error(`edit.createEdgeFace: ${message}`);
    };

    let sourceIds = vertexIds;
    let neighborEdgeIds = edgeIds;
    let newVertexId = null;

    if (vertexIds.length === 1) {
      const quad = vertexEditor.fill.computeQuadFromVertex(meshData.getVertex(vertexIds[0]));
      if (!quad) fail('cannot complete a quad from this vertex (needs two open edges).');

      sourceIds = quad.quadVertexIds;
      neighborEdgeIds = quad.openEdgeIds;
      newVertexId = quad.quadVertexIds[3];
    }

    const { sortedVertexIds, normal } = getSortedVertexIds(meshData, sourceIds);
    const neighbors = getNeighborFaces(meshData, neighborEdgeIds);
    if (shouldFlipNormal(meshData, sortedVertexIds, normal, neighbors)) sortedVertexIds.reverse();

    const result = vertexEditor.fill.createEdgeFaceFromVertices(sortedVertexIds);
    if (!result) fail('fill failed for these vertices.');

    const { edgeId, faceId } = result;
    const created = faceId != null ? 'face' : 'edge';
    const element = created === 'face' ? meshData.faces.get(faceId) : meshData.edges.get(edgeId);
    if (!element) fail(`created ${created} not found.`);

    const newVertices = created === 'face' ? [...element.vertexIds] : [element.v1Id, element.v2Id];
    const newEdges = created === 'face' ? [...element.edgeIds] : [edgeId];

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new CreateFaceCommand(editor, object, beforeSnapshot, afterSnapshot));

    const mode = editSelection.subSelectionMode;
    if (mode === 'vertex') {
      editSelection.selectVertices(newVertexId != null ? [newVertexId] : newVertices);
    } else if (mode === 'edge') {
      editSelection.selectEdges(newEdges);
    } else if (mode === 'face' && created === 'face') {
      editSelection.selectFaces([faceId]);
    }

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      created,
      ...(created === 'face' ? { faceId } : { edgeId }),
      vertexIds: newVertices,
      ...(newVertexId != null && { newVertexId }),
    };
  },
};