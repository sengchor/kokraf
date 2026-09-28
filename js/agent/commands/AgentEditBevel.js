import { BevelOps, BevelBuilder } from '../../operations/BevelOps.js';
import { resolveMeshTarget, resolveEdgeIds } from '../AgentUtils.js';

const MAX_SEGMENTS = 64;

export const editBevelSpec = {
  description:
    'Bevel edges of a mesh: each edge is replaced by a strip of `segments` faces, its sides offset by `width` ' +
    'along the neighbouring faces, with corners filled where beveled edges meet. ' +
    "edges defaults to 'selected' (the current edit selection), which only works if the target is ALREADY in Edit Mode; " +
    "otherwise pass 'all' or edge ids from mesh.inspect. " +
    'Only manifold edges (exactly two faces) can be beveled; others are skipped and reported in skippedEdgeIds. ' +
    'width is in metres and is not clamped: too large a width makes the bevel overlap neighbouring geometry. ' +
    'Afterwards the new bevel faces are selected (as vertices, edges or faces, following the selection mode), ' +
    "so a following edit.transform with vertices: 'selected' acts on them. Undoable as one step.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    edges: {
      anyOf: [
        { type: 'string', enum: ['selected', 'all'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      description: "'selected', 'all', or an array of edge ids. Default: \"selected\".",
    },
    width: { type: 'number', description: 'Bevel offset in metres. Must be > 0.' },
    segments: {
      type: 'number',
      default: 1,
      description: `Number of faces across each bevel, an integer from 1 to ${MAX_SEGMENTS}. More segments give a rounder bevel.`,
    },
  },

  prepare({ target, edges, width, segments = 1 }, editor) {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
      throw new Error('edit.bevel: width must be a number greater than 0.');
    }
    if (!Number.isInteger(segments) || segments < 1 || segments > MAX_SEGMENTS) {
      throw new Error(`edit.bevel: segments must be an integer from 1 to ${MAX_SEGMENTS}.`);
    }

    const { object, meshData } = resolveMeshTarget(editor, target, 'edit.bevel');
    const label = object.name || object.uuid;

    const requestedEdgeIds = resolveEdgeIds(editor, object, edges, 'edit.bevel');
    if (!requestedEdgeIds.length) throw new Error(`edit.bevel: no edges to bevel on "${label}".`);

    const edgeIds = BevelOps.filterValidEdges(meshData, requestedEdgeIds);
    if (!edgeIds.length) {
      throw new Error(
        `edit.bevel: none of the edges on "${label}" can be beveled; only manifold edges (exactly two faces) are supported.`
      );
    }

    const validSet = new Set(edgeIds);
    const skippedEdgeIds = requestedEdgeIds.filter(id => !validSet.has(id));

    return { modeTarget: object, object, edgeIds, skippedEdgeIds, segments };
  },

  run({ width }, editor, { object, edgeIds, skippedEdgeIds, segments }) {
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const meshData = object.userData.meshData;
    const { vertexEditor, editSelection } = editor;

    const selectionMode = editSelection.subSelectionMode;

    vertexEditor.setObject(object);
    const builder = new BevelBuilder(vertexEditor, object, segments);

    try {
      builder.build(edgeIds);

      if (!builder.newFaceIds.length) {
        throw new Error('edit.bevel: the bevel produced no faces. Nothing was changed.');
      }

      editor.signals.editSelectionRefresh.dispatch();
      editSelection.selectFaces(builder.newFaceIds);

      builder.applyWidth(width);
    } catch (error) {
      if (builder.beforeSnapshot && builder.startElements) builder.restore();
      editSelection.selectEdges(edgeIds);
      editor.signals.editSelectionRefresh.dispatch();
      throw error;
    }

    editor.add(BevelOps.createCommand(editor, object, builder));

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    BevelOps.selectResult(editSelection, builder);
    editor.signals.editSelectionRefresh.dispatch();
    editor.signals.objectChanged.dispatch();

    const { startVertexId, startEdgeId, startFaceId } = builder.startElements;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      selectionMode,
      beveledEdgeCount: edgeIds.length,
      skippedEdgeIds,
      width,
      segments,
      created: {
        vertices: countFrom(meshData.vertices, startVertexId),
        edges: countFrom(meshData.edges, startEdgeId),
        faces: countFrom(meshData.faces, startFaceId),
      },
      selected: `new bevel ${selectionMode}s`,
    };
  },
};

function countFrom(elements, startId) {
  let count = 0;
  for (const id of elements.keys()) if (id >= startId) count++;
  return count;
}