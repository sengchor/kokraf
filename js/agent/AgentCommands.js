import * as THREE from 'three';
import { ObjectTransformOps } from '../operations/ObjectTransformOps.js';
import { EditTransformOps } from '../operations/EditTransformOps.js';
import { MODES } from '../core/ModeManager.js';
import {
  describeObject,
  resolveTargets,
  resolveVertexIds,
  toScaleVector,
} from './AgentUtils.js';
import {
  AXES_NOTE,
  positionToThree,
  positionFromThree,
  pivotToThree,
  rotationToThree,
  rotationFromThree,
  scaleToThree,
  scaleFromThree,
} from './AgentAxes.js'

function defineModeCommand(registry, name, { prepare, run, ...spec }) {
  const mode = name.split('.')[0];
  if (!MODES[mode]) {
    throw new Error(`defineModeCommand: "${name}" prefix "${mode}" is not an editor mode.`);
  }

  return registry.define(name, {
    ...spec,
    mode,
    run(params, editor) {
      const ctx = prepare ? prepare(params, editor) ?? {} : {};
      const modeSwitched = editor.modeManager.switchTo(mode, ctx.modeTarget ?? null);
      const result = run(params, editor, ctx);
      return { mode, modeSwitched, ...result };
    },
  });
}

export function registerAgentCommands(registry) {
  registry.define('scene.outline', {
    description:
      AXES_NOTE +
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
        currentMode: editor.modeManager.currentMode,
        editedObjectUuid: editor.editSelection.editedObject?.uuid ?? null,
        objectCount: objects.length,
        truncated,
        objects,
      };
    },
  });

  defineModeCommand(registry, 'object.transform', {
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
        changes.scales = ObjectTransformOps.resolveScales(objects, toScaleVector(scaleToThree(scale)), options);
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
  });

  defineModeCommand(registry, 'edit.transform', {
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
        scale: scale && toScaleVector(scaleToThree(scale))
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
  });

  return registry;
}