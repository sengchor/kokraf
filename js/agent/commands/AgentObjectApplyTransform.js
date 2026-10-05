import * as THREE from 'three';
import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { ApplyLocationCommand } from '../../commands/ApplyLocationCommand.js';
import { ApplyRotationCommand } from '../../commands/ApplyRotationCommand.js';
import { ApplyScaleCommand } from '../../commands/ApplyScaleCommand.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionFromThree, rotationFromThree, scaleFromThree } from '../AgentAxes.js';

// Execution order is fixed: scale, then rotation, then location.
// Baking rotation while a non-uniform scale is still on the object would skew the mesh.
const ORDER = ['scale', 'rotation', 'location'];

const COMMANDS = {
  scale: ApplyScaleCommand,
  rotation: ApplyRotationCommand,
  location: ApplyLocationCommand,
};

const label = (object) => object.name || object.uuid;

const isGeometryObject = (object) => object?.isMesh && !object.userData?.isImageRef;

const localTransform = (object) => ({
  position: positionFromThree(object.position),
  rotation: rotationFromThree(object.quaternion),
  scale: scaleFromThree(object.scale),
});

function hasNonUniformScale(object, eps = 1e-4) {
  const { x, y, z } = object.scale;
  return Math.abs(x - y) > eps || Math.abs(y - z) > eps || Math.abs(x - z) > eps;
}

const isRotated = (object) => Math.abs(object.quaternion.w) < 1 - 1e-8;

export const objectApplyTransformSpec = {
  description:
    AXES_NOTE +
    "Bake parts of each object's local transform into its mesh data, then reset those parts " +
    '(location to [0,0,0], rotation to [0,0,0], scale to [1,1,1]). The mesh stays where it is in the world. ' +
    'Components always run in the order scale, rotation, location, whatever order you list them in. ' +
    'Mesh objects only. Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them. Every target must be a mesh.',
    },
    apply: {
      type: 'string|string[]',
      enum: ORDER,
      default: ['location', 'rotation', 'scale'],
      description:
        "Which components to apply: 'location', 'rotation', 'scale', or an array of them. Defaults to all three.",
    },
  },
  prepare({ target, apply }, editor) {
    const requested = apply === undefined ? ORDER : Array.isArray(apply) ? apply : [apply];
    if (!requested.length) {
      throw new Error("object.applyTransform: apply is empty. Pass 'location', 'rotation', 'scale' or an array of them.");
    }

    const unknown = requested.filter((c) => !ORDER.includes(c));
    if (unknown.length) {
      throw new Error(
        `object.applyTransform: unknown component(s) ${unknown.map((c) => JSON.stringify(c)).join(', ')}. ` +
        "Use 'location', 'rotation' or 'scale'."
      );
    }

    const objects = [...new Set(resolveTargets(editor, target))];

    const invalid = objects.filter((object) => !isGeometryObject(object));
    if (invalid.length) {
      throw new Error(
        `object.applyTransform: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not a mesh. Only mesh objects have geometry to bake the transform into.'
      );
    }

    const components = ORDER.filter((c) => requested.includes(c));
    return { objects, components };
  },
  run(_params, editor, { objects, components }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const warnings = [];
    if (components.includes('rotation') && !components.includes('scale')) {
      for (const object of objects) {
        if (hasNonUniformScale(object) && isRotated(object)) {
          warnings.push(
            `"${label(object)}" has non-uniform scale; applying rotation without scale may skew the mesh. ` +
            "Include 'scale' to avoid this."
          );
        }
      }
    }

    const before = new Map(objects.map((object) => [object, localTransform(object)]));

    const name = components.length === ORDER.length
      ? 'Agent Apply Transform'
      : `Agent Apply ${components.map((c) => c[0].toUpperCase() + c.slice(1)).join(' + ')}`;

    const multi = new SequentialMultiCommand(editor, name);
    for (const object of objects) {
      for (const component of components) {
        const Command = COMMANDS[component];
        multi.add(() => new Command(editor, object));
      }
    }
    editor.execute(multi);

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    const result = {
      applied: components,
      objects: objects.map((object) => ({
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        before: before.get(object),
        after: localTransform(object),
      })),
    };

    if (warnings.length) result.warnings = warnings;
    return result;
  },
};