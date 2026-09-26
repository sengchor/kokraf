import * as THREE from 'three';
import { ObjectTransformOps } from '../../operations/ObjectTransformOps.js';
import { resolveTargets } from '../AgentUtils.js';
import {
  AXES_NOTE,
  positionToThree,
  positionFromThree,
  rotationToThree,
  rotationFromThree,
  scaleToThree,
  scaleFromThree,
} from '../AgentAxes.js';

export const objectTransformSpec = {
  description:
    AXES_NOTE +
    'Move, rotate and/or scale objects. Each object transforms about its own origin. ' +
    'Undoable via the normal history stack. At least one of position, rotation or scale is required.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them.',
    },
    position: { type: 'vec3', optional: true, description: '[x, y, z] in metres.' },
    rotation: { type: 'vec3', optional: true, description: '[x, y, z] Euler angles in DEGREES, XYZ order.' },
    scale: {
      type: 'number|vec3',
      optional: true,
      description: 'Uniform factor or [x, y, z]. Always object-local — space is ignored for scale.',
    },
    relative: {
      type: 'boolean',
      default: false,
      description: 'true adds/multiplies onto the current transform; false sets it absolutely.',
    },
    space: {
      type: 'string',
      enum: ['world', 'local'],
      default: 'world',
      description: 'Frame for position and rotation.',
    },
  },
  prepare({ target, position, rotation, scale }, editor) {
    if (position === undefined && rotation === undefined && scale === undefined) {
      throw new Error('object.transform: supply at least one of position, rotation or scale.');
    }
    return { objects: resolveTargets(editor, target) };
  },
  run({ position, rotation, scale, relative, space }, editor, { objects }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    // Resolve everything against the pre-transform state, then execute once.
    const options = { relative, space };
    const changes = {};

    if (position !== undefined) {
      changes.positions = ObjectTransformOps.resolvePositions(objects, positionToThree(position), options);
    }

    if (rotation !== undefined) {
      changes.quaternions = ObjectTransformOps.resolveQuaternions(objects, rotationToThree(rotation), options);
    }

    if (scale !== undefined) {
      changes.scales = ObjectTransformOps.resolveScales(objects, scaleToThree(scale), options);
    }

    editor.execute(ObjectTransformOps.createCommand(editor, objects, changes, 'Agent Transform'));

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    return {
      applied: [position && 'position', rotation && 'rotation', scale && 'scale'].filter(Boolean),
      relative,
      space,
      objects: objects.map((object) => ({
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        worldPosition: positionFromThree(object.getWorldPosition(new THREE.Vector3())),
        rotation: rotationFromThree(object.getWorldQuaternion(new THREE.Quaternion())),
        scale: scaleFromThree(object.scale),
      })),
    };
  },
};