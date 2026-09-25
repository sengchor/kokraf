import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { PRIMITIVE_DEFAULTS, MESH_TYPES } from '../utils/ObjectFactory.js';
import { describeObject } from './AgentUtils.js';
import { AXES_NOTE, positionToThree, rotationToThree, scaleToThree } from './AgentAxes.js';

const SEGMENT_MIN = { heightSegments: 2 };
const MAX_SEGMENTS = 256;

const PRIMITIVE_NOTES = {
  Plane: 'lies flat on the ground; width and height are both horizontal (height is depth, not vertical)',
  Cube: 'height is vertical',
  Circle: 'lies flat on the ground as a single n-gon face',
  Sphere: 'widthSegments around the equator, heightSegments pole to pole (min 2)',
  Cylinder: 'axis vertical, n-gon caps',
  Cone: 'apex up, n-gon base',
  Torus:
    'lies flat; radius = ring centre to tube centre, tube = tube radius (must be < radius); ' +
    'radialSegments go AROUND THE RING, tubularSegments around the tube cross-section '
};

const PRIMITIVE_DOC = Object.entries(PRIMITIVE_DEFAULTS)
  .map(([type, p]) => `${type} ${JSON.stringify(p)}: ${PRIMITIVE_NOTES[type]}`)
  .join('. ');

function validatePrimitiveParams(type, params) {
  const defaults = PRIMITIVE_DEFAULTS[type];
  if (!defaults) {
    throw new Error(`object.addMesh: unknown type "${type}". Valid: ${MESH_TYPES.join(', ')}.`);
  }
  if (params == null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('object.addMesh: params must be an object.');
  }

  for (const [key, value] of Object.entries(params)) {
    if (!(key in defaults)) {
      throw new Error(`object.addMesh: "${key}" is not a ${type} param. Valid: ${Object.keys(defaults).join(', ')}.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`object.addMesh: ${key} must be a positive number.`);
    }
    if (/segments$/i.test(key)) {
      const min = SEGMENT_MIN[key] ?? 3;
      if (!Number.isInteger(value) || value < min || value > MAX_SEGMENTS) {
        throw new Error(`object.addMesh: ${key} must be an integer between ${min} and ${MAX_SEGMENTS}.`);
      }
    }
  }

  if (type === 'Torus') {
    const { radius, tube } = { ...defaults, ...params };
    if (tube >= radius) {
      throw new Error(
        `object.addMesh: Torus tube (${tube}) must be smaller than radius (${radius}), or the surface self-intersects.`
      );
    }
  }

  return params;
}

export const objectAddMeshSpec = {
  description:
    AXES_NOTE +
    'Add a primitive mesh to the scene root and select it. Undoable as one step. ' +
    'All primitives are centred on their origin — to rest one on the ground, set its vertical position to half its height. ' +
    `Types, default params (metres) and orientation: ${PRIMITIVE_DOC}. ` +
    "Omitted params use the defaults. Returns the new object's uuid — use it for later commands.",
  mutates: true,
  params: {
    type: { type: 'string', enum: MESH_TYPES, description: 'Primitive type.' },
    name: { type: 'string', optional: true, description: 'Base name; made unique automatically.' },
    params: {
      type: 'object',
      optional: true,
      description: 'Shape parameters for the chosen type (see description).',
    },
    position: { type: 'vec3', optional: true, description: '[x, y, z] in metres. Default origin.' },
    rotation: { type: 'vec3', optional: true, description: '[x, y, z] Euler angles in DEGREES, XYZ order.' },
    scale: { type: 'number|vec3', optional: true, description: 'Uniform factor or [x, y, z].' },
  },

  prepare({ type, params }) {
    return { params: validatePrimitiveParams(type, params) };
  },

  run({ type, name, position, rotation, scale }, editor, { params }) {
    const mesh = editor.objectFactory.createGeometry(type, { params, name });
    if (!mesh) throw new Error(`object.addMesh: failed to build "${type}".`);

    if (position !== undefined) mesh.position.copy(positionToThree(position));
    if (rotation !== undefined) mesh.quaternion.copy(rotationToThree(rotation));
    if (scale !== undefined) mesh.scale.copy(scaleToThree(scale));
    mesh.updateMatrixWorld(true);

    editor.execute(new AddObjectCommand(editor, mesh));
    editor.signals.objectChanged.dispatch();

    return {
      ...describeObject(mesh, 0, { includeStats: true, includeMaterials: false }),
      primitive: mesh.userData.primitive,
    };
  },
};