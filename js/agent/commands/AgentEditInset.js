import { InsetOps } from '../../operations/InsetOps.js';
import { resolveMeshTarget, resolveFaceIds } from '../AgentUtils.js';

export const editInsetSpec = {
  description:
    'Inset faces of a mesh: each connected group of faces is inset as one region, its boundary ' +
    'pulled inward by `width` along the faces, with a ring of side faces bridging the old boundary to the new one. ' +
    "faces defaults to 'selected' (the current edit selection), which only works if the target is ALREADY in Edit Mode; " +
    "otherwise pass 'all' or face ids from mesh.inspect. " +
    'width is in metres and is not clamped: too large a width makes the inner faces overlap or flip. ' +
    'Rejected without changes if the faces have no open boundary (e.g. every face of a closed mesh). ' +
    'Afterwards the new inner faces are selected (as vertices, edges or faces, following the selection mode), ' +
    "so a following edit.extrude or edit.transform with vertices: 'selected' acts on them. Undoable as one step.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    faces: {
      type: 'string|number[]',
      default: 'selected',
      description:
        "'selected' (current edit selection; the target must already be in Edit Mode), 'all', or an array of face ids.",
    },
    width: { type: 'number', description: 'Inset distance in metres. Must be > 0.' },
  },

  prepare({ target, faces, width }, editor) {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
      throw new Error('edit.inset: width must be a number greater than 0.');
    }

    const { object } = resolveMeshTarget(editor, target, 'edit.inset');

    const faceIds = resolveFaceIds(editor, object, faces, 'edit.inset');
    if (!faceIds.length) {
      throw new Error(`edit.inset: no faces to inset on "${object.name || object.uuid}".`);
    }

    return { modeTarget: object, object, faceIds };
  },

  run({ width }, editor, { object, faceIds }) {
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const meshData = object.userData.meshData;
    const { vertexEditor, editSelection } = editor;

    const selectionMode = editSelection.subSelectionMode;

    vertexEditor.setObject(object);
    const inset = InsetOps.buildInset(vertexEditor, editSelection, object, faceIds);

    try {
      if (!inset.moveData.size) {
        throw new Error('edit.inset: the faces have no open boundary to inset (e.g. a closed mesh). Nothing was changed.');
      }

      const { vertexIds, positions } = InsetOps.computeWidthPositions(inset, width);
      vertexEditor.transform.setVertexPositions(vertexIds, positions);
    } catch (error) {
      InsetOps.restore(vertexEditor, object, inset);
      editSelection.selectFaces(faceIds);
      editor.signals.editSelectionRefresh.dispatch();
      throw error;
    }

    editor.add(InsetOps.createCommand(editor, object, inset));

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    InsetOps.selectResult(editSelection, inset);
    editor.signals.editSelectionRefresh.dispatch();
    editor.signals.objectChanged.dispatch();

    const { startVertexId, startEdgeId, startFaceId } = inset.startElements;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      selectionMode,
      insetFaceCount: faceIds.length,
      created: {
        vertices: countFrom(meshData.vertices, startVertexId),
        edges: countFrom(meshData.edges, startEdgeId),
        faces: countFrom(meshData.faces, startFaceId),
      },
      width,
      selected: `new inner ${selectionMode}s`,
    };
  },
};

function countFrom(elements, startId) {
  let count = 0;
  for (const id of elements.keys()) if (id >= startId) count++;
  return count;
}