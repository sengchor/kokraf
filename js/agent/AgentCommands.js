import * as THREE from 'three';
import { ObjectTransformOps } from '../operations/ObjectTransformOps.js';
import {
  RAD,
  DEG,
  r,
  vec,
  describeObject,
  resolveTargets,
  toScaleVector,
} from './AgentUtils.js';

export function registerAgentCommands(registry) {
  registry.define('scene.outline', {
    description:
      'List the objects in the scene with their uuid, type, transform, and vertex/edge/face counts. ' +
      'Counts describe the editable mesh topology, so faces are n-gons, not triangles. ' +
      'Returns no geometry data — use this to find the uuid of an object before acting on it.',
    mutates: false,
    params: {
      root: {
        type: 'string',
        optional: true,
        description: 'uuid of a subtree root. Omit to outline the whole scene.',
      },
      depth: {
        type: 'number',
        default: -1,
        description: 'Maximum depth to descend. -1 for unlimited.',
      },
      includeStats: { type: 'boolean', default: true, description: 'Include vertex/edge/face counts.' },
      includeMaterials: { type: 'boolean', default: false, description: 'Include material names and colors.' },
      maxObjects: { type: 'number', default: 100, description: 'Hard cap on returned objects.' },
    },
    run({ root, depth, includeStats, includeMaterials, maxObjects }, editor) {
      const scene = editor.sceneManager.mainScene;
      const rootObject = root ? scene.getObjectByProperty('uuid', root) : scene;

      if (!rootObject) throw new Error(`No object with uuid "${root}" in the scene.`);

      const objects = [];
      let truncated = false;

      const walk = (object, level) => {
        if (truncated) return;

        if (object !== rootObject) {
          if (object.userData?.isEditorOnly) return;
          if (objects.length >= maxObjects) {
            truncated = true;
            return;
          }
          objects.push(describeObject(object, level, { includeStats, includeMaterials }));
        }

        if (depth !== -1 && level >= depth) return;
        for (const child of object.children) walk(child, level + 1);
      };

      walk(rootObject, 0);

      return {
        sceneUuid: scene.uuid,
        rootUuid: rootObject === scene ? null : rootObject.uuid,
        objectCount: objects.length,
        truncated,
        objects,
      };
    },
  });

  registry.define('transform', {
    description:
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
    run({ target, position, rotation, scale, relative, space }, editor) {
      if (position === undefined && rotation === undefined && scale === undefined) {
        throw new Error('transform: supply at least one of position, rotation or scale.');
      }

      const scene = editor.sceneManager.mainScene;
      const objects = resolveTargets(editor, target);
      scene.updateMatrixWorld(true);

      // Resolve everything against the pre-transform state, then execute once.
      const options = { relative, space };
      const changes = {};

      if (position !== undefined) {
        changes.positions = ObjectTransformOps.resolvePositions(objects, position, options);
      }

      if (rotation !== undefined) {
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rotation[0] * RAD, rotation[1] * RAD, rotation[2] * RAD, 'XYZ')
        );
        changes.quaternions = ObjectTransformOps.resolveQuaternions(objects, quaternion, options);
      }

      if (scale !== undefined) {
        changes.scales = ObjectTransformOps.resolveScales(objects, toScaleVector(scale), options);
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
          worldPosition: vec(object.getWorldPosition(new THREE.Vector3())),
          rotation: [
            r(object.rotation.x * DEG, 2),
            r(object.rotation.y * DEG, 2),
            r(object.rotation.z * DEG, 2),
          ],
          scale: vec(object.scale),
        })),
      };
    },
  });

  return registry;
}