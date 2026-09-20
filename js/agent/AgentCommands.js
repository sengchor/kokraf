import * as THREE from 'three';
import { SetPositionCommand } from '../commands/SetPositionCommand.js';
import { SetRotationCommand } from '../commands/SetRotationCommand.js';
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { MultiCommand } from '../commands/MultiCommand.js';
import {
  RAD,
  DEG,
  r,
  vec,
  pureWorldQuaternion,
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

      const objects = resolveTargets(editor, target);
      editor.sceneManager.mainScene.updateMatrixWorld(true);

      const multi = new MultiCommand(editor, 'Agent Transform');

      // --- position: Set*Command takes WORLD positions ---------------
      if (position !== undefined) {
        const oldPositions = objects.map((o) => o.getWorldPosition(new THREE.Vector3()));
        const input = new THREE.Vector3().fromArray(position);

        const newPositions = objects.map((object, i) => {
          if (relative) {
            const delta = input.clone();
            if (space === 'local') delta.applyQuaternion(pureWorldQuaternion(object));
            return oldPositions[i].clone().add(delta);
          }
          if (space === 'local' && object.parent) {
            return input.clone().applyMatrix4(object.parent.matrixWorld);
          }
          return input.clone();
        });

        multi.add(new SetPositionCommand(editor, objects, newPositions, oldPositions));
      }

      // --- rotation: Set*Command takes WORLD quaternions --------------
      if (rotation !== undefined) {
        const oldQuaternions = objects.map((o) => pureWorldQuaternion(o));
        const input = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rotation[0] * RAD, rotation[1] * RAD, rotation[2] * RAD, 'XYZ')
        );

        const newQuaternions = objects.map((object, i) => {
          if (relative) {
            // local: spin about the object's own axes. world: about global axes.
            return space === 'local'
              ? oldQuaternions[i].clone().multiply(input)
              : input.clone().multiply(oldQuaternions[i]);
          }
          if (space === 'local' && object.parent) {
            return pureWorldQuaternion(object.parent).multiply(input);
          }
          return input.clone();
        });

        multi.add(new SetRotationCommand(editor, objects, newQuaternions, oldQuaternions));
      }

      // --- scale: Set*Command takes LOCAL scale ----------------------
      if (scale !== undefined) {
        const oldScales = objects.map((o) => o.scale.clone());
        const factor = toScaleVector(scale);

        const newScales = objects.map((_, i) =>
          relative ? oldScales[i].clone().multiply(factor) : factor.clone()
        );

        multi.add(new SetScaleCommand(editor, objects, newScales, oldScales));
      }

      editor.execute(multi);

      editor.sceneManager.mainScene.updateMatrixWorld(true);
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