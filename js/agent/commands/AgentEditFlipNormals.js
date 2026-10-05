import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { FlipNormalsCommand } from '../../commands/FlipNormalsCommand.js';
import { resolveMeshTarget, resolveFaceIds } from '../AgentUtils.js';

export const editFlipNormalsSpec = {
  description:
    'Flip face normals (reverse winding). ' +
    "faces: 'selected' requires the target to already be in Edit Mode. Undoable.",
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    faces: {
      anyOf: [
        { type: 'string', enum: ['selected', 'all'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      default: 'selected',
      description: "'selected', 'all', or an array of face ids.",
    },
  },
  prepare({ target, faces }, editor) {
    const { object } = resolveMeshTarget(editor, target, 'edit.flipNormals');

    const faceIds = resolveFaceIds(editor, object, faces, 'edit.flipNormals');
    if (!faceIds.length) throw new Error('edit.flipNormals: no faces to flip.');

    return { modeTarget: object, object, faceIds };
  },
  run(params, editor, { object, faceIds }) {
    const meshData = object.userData.meshData;

    editor.vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { faceIds }, 1);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    editor.meshEditor.flipNormals(meshData, faceIds);

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    editor.execute(new FlipNormalsCommand(editor, object, beforeSnapshot, afterSnapshot));
    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      flippedCount: faceIds.length,
    };
  },
};