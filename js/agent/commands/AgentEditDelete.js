import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { DeleteSelectionCommand } from '../../commands/DeleteSelectionCommand.js';
import { resolveMeshTarget, resolveElementIds, meshStats } from '../AgentUtils.js';

const REGION_KEY = { vertex: 'vertexIds', edge: 'edgeIds', face: 'faceIds' };

const DELETE_FN = {
  vertex: 'deleteVertices',
  edge: 'deleteEdges',
  face: 'deleteFaces',
};

const DELETE_ONLY_FN = {
  edge: 'deleteEdgesAndFacesOnly',
  face: 'deleteFacesOnly',
};

const DISSOLVE_FN = {
  vertex: 'dissolveVertices',
  edge: 'dissolveEdges',
  face: 'dissolveFaces',
};

const sharedParams = {
  target: { type: 'string', description: 'uuid or name of a mesh object.' },
  element: { type: 'string', enum: ['vertex', 'edge', 'face'], description: 'Element type of ids.' },
  ids: {
    anyOf: [
      { type: 'string', enum: ['selected', 'all'] },
      { type: 'array', items: { type: 'integer' } },
    ],
    default: 'selected',
    description: "'selected', 'all', or an array of ids.",
  },
};

function prepareTopology(command, { target, element, ids }, editor) {
  if (!REGION_KEY[element]) {
    throw new Error(`${command}: element must be 'vertex', 'edge' or 'face'.`);
  }

  const { object } = resolveMeshTarget(editor, target, command);

  const elementIds = resolveElementIds(editor, object, ids, element, command);
  if (!elementIds.length) throw new Error(`${command}: no ${element}s given.`);

  const { editSelection } = editor;
  const region = ids === 'selected'
    ? {
        vertexIds: Array.from(editSelection.selectedVertexIds),
        edgeIds: Array.from(editSelection.selectedEdgeIds),
        faceIds: Array.from(editSelection.selectedFaceIds),
      }
    : { [REGION_KEY[element]]: elementIds };

  return { modeTarget: object, object, elementIds, region };
}

function runTopology(editor, { object, elementIds, region }, apply, extra) {
  const meshData = object.userData.meshData;
  const before = meshStats(object);

  const beforeRegionIds = MeshDataRegion.expand(meshData, region, 2);
  const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

  const startElements = {
    startVertexId: meshData.nextVertexId,
    startEdgeId: meshData.nextEdgeId,
    startFaceId: meshData.nextFaceId,
  };

  editor.vertexEditor.setObject(object);
  apply(editor.vertexEditor, elementIds);

  MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
  const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
  const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

  editor.execute(new DeleteSelectionCommand(editor, object, beforeSnapshot, afterSnapshot));

  object.geometry.computeBoundingBox();
  object.geometry.computeBoundingSphere();
  editor.signals.objectChanged.dispatch();

  const after = meshStats(object);

  return {
    uuid: object.uuid,
    name: object.name || '(unnamed)',
    ...extra,
    count: elementIds.length,
    delta: {
      vertices: after.vertices - before.vertices,
      edges: after.edges - before.edges,
      faces: after.faces - before.faces,
    },
  };
}

export const editDeleteSpec = {
  description:
    'Delete mesh elements. Deleting vertices/edges also removes connected edges/faces. ' +
    "only:true (edge/face) removes faces but keeps vertices (and edges for face). " +
    "ids: 'selected' requires the target to already be in Edit Mode. Undoable.",
  mutates: true,
  params: {
    ...sharedParams,
    only: { type: 'boolean', default: false, description: 'Edge/face only.' },
  },
  prepare(params, editor) {
    if (params.only && params.element === 'vertex') {
      throw new Error("edit.delete: only:true is not valid for element 'vertex'.");
    }
    return prepareTopology('edit.delete', params, editor);
  },
  run({ element, only = false }, editor, ctx) {
    const fn = only ? DELETE_ONLY_FN[element] : DELETE_FN[element];
    return runTopology(editor, ctx, (ve, ids) => ve.delete[fn](ids), { element, only });
  },
};

export const editDissolveSpec = {
  description:
    'Dissolve mesh elements: remove them and merge surrounding faces to close the gap. ' +
    "ids: 'selected' requires the target to already be in Edit Mode. Undoable.",
  mutates: true,
  params: sharedParams,
  prepare(params, editor) {
    return prepareTopology('edit.dissolve', params, editor);
  },
  run({ element }, editor, ctx) {
    return runTopology(editor, ctx, (ve, ids) => ve.dissolve[DISSOLVE_FN[element]](ids), { element });
  },
};