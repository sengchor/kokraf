import { EditTransformOps } from '../../operations/EditTransformOps.js';
import { resolveTargets, resolveVertexIds } from '../AgentUtils.js';
import {
  AXES_NOTE,
  positionToThree,
  positionFromThree,
  pivotToThree,
  rotationToThree,
  scaleToThree,
} from '../AgentAxes.js';

export const editTransformSpec = {
  description:
    AXES_NOTE +
    'Move, rotate and/or scale mesh vertices of a single object (edit-mode transform). ' +
    "vertices: 'selected' only works if the target is ALREADY in Edit Mode; otherwise pass 'all' or ids. " +
    'Applied in order scale -> rotate -> translate, all about the same pivot. ' +
    'Undoable as one step. At least one of translate, rotate or scale is required.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    vertices: {
      type: 'string|number[]',
      default: 'selected',
      description: "'selected' (current edit selection), 'all', or an array of vertex ids.",
    },
    translate: { type: 'vec3', optional: true, description: '[x, y, z] offset in metres.' },
    rotate: { type: 'vec3', optional: true, description: '[x, y, z] Euler angles in DEGREES, XYZ order, about the pivot.' },
    scale: { type: 'number|vec3', optional: true, description: 'Uniform factor or [x, y, z], about the pivot.' },
    pivot: {
      type: 'string|vec3',
      default: 'median',
      description: "'median' (vertex average), 'origin' (object origin), or a world-space [x, y, z].",
    },
    space: {
      type: 'string',
      enum: ['world', 'local'],
      default: 'world',
      description: "Axes for translate/rotate/scale. 'local' uses the object's orientation.",
    },
  },
  prepare({ target, vertices, translate, rotate, scale }, editor) {
    if (translate === undefined && rotate === undefined && scale === undefined) {
      throw new Error('edit.transform: supply at least one of translate, rotate or scale.');
    }

    const objects = resolveTargets(editor, target);
    if (objects.length !== 1) throw new Error('edit.transform: target must resolve to exactly one object.');
    const object = objects[0];

    if (!editor.modeManager.isValidMesh(object)) {
      throw new Error(`edit.transform: "${object.name || object.uuid}" is not an editable mesh.`);
    }

    const vertexIds = resolveVertexIds(editor, object, vertices);
    if (!vertexIds.length) throw new Error('edit.transform: no vertices to transform.');

    return { modeTarget: object, object, vertexIds };
  },
  run({ translate, rotate, scale, pivot, space }, editor, { object, vertexIds }) {
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const from = EditTransformOps.getPositions(editor, object, vertexIds);
    const positions = EditTransformOps.resolvePositions(object, from, {
      translate: translate && positionToThree(translate),
      rotate: rotate && rotationToThree(rotate),
      scale: scale && scaleToThree(scale)
    }, { pivot: pivotToThree(pivot), space });

    editor.execute(EditTransformOps.createCommand(editor, object, vertexIds, { positions }));
    editor.signals.objectChanged.dispatch();

    const median = EditTransformOps.resolvePivot('median', object, positions.to);

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      applied: [scale !== undefined && 'scale', rotate && 'rotate', translate && 'translate'].filter(Boolean),
      vertexCount: vertexIds.length,
      space,
      pivot: positionFromThree(positions.pivot),
      newMedian: positionFromThree(median),
    };
  },
};