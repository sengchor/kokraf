import * as THREE from 'three';
import { r, positionFromThree, rotationFromThree, scaleFromThree } from './AgentAxes.js';

const label = (object) => object.name || object.uuid;

const SELECTED_IDS = { vertex: 'selectedVertexIds', edge: 'selectedEdgeIds', face: 'selectedFaceIds' };

function size(collection) {
  if (!collection) return 0;
  if (collection instanceof Map || collection instanceof Set) return collection.size;
  if (Array.isArray(collection)) return collection.length;
  return 0;
}

export function meshStats(object) {
  const meshData = object.userData?.meshData;
  if (!meshData) return null;

  const stats = {
    vertices: size(meshData.vertices),
    edges: size(meshData.edges),
    faces: size(meshData.faces),
  };

  const uvs = size(meshData.uvs);
  if (uvs > 0) stats.uvs = uvs;

  return stats;
}

export function describeObject(object, depth, { includeStats, includeMaterials }) {
  const entry = {
    uuid: object.uuid,
    name: object.name || '(unnamed)',
    type: object.type,
    depth,
    parent: object.parent && !object.parent.isScene ? object.parent.uuid : null,
    position: positionFromThree(object.position),
    rotation: rotationFromThree(object.quaternion),
    scale: scaleFromThree(object.scale),
  };

  if (object.visible === false) entry.visible = false;

  if (includeStats && object.userData?.meshData) {
    entry.stats = meshStats(object);
  }

  if (includeMaterials && object.material) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    entry.materials = materials.map((m) => ({
      name: m.name || '(unnamed)',
      type: m.type,
      color: m.color ? `#${m.color.getHexString()}` : undefined,
    }));
  }

  if (object.isLight) {
    entry.light = {
      color: object.color ? `#${object.color.getHexString()}` : undefined,
      intensity: r(object.intensity, 3),
    };
  }

  if (object.isCamera) {
    entry.camera = { fov: object.fov ? r(object.fov, 2) : undefined, isDefault: !!object.isDefault };
  }

  return entry;
}

export function resolveTargets(editor, target) {
  const scene = editor.sceneManager.mainScene;
  const keys = Array.isArray(target) ? target : [target];

  if (!keys.length) throw new Error('target is empty. Pass a uuid, a name, or an array of them.');

  return keys.map((key) => {
    const object =
      scene.getObjectByProperty('uuid', key) ?? scene.getObjectByName(key);
    if (!object) throw new Error(`No object matches "${key}". Call scene.outline to get valid uuids.`);
    return object;
  });
}

export function resolveMeshTarget(editor, target, command) {
  const objects = resolveTargets(editor, target);
  if (objects.length !== 1) throw new Error(`${command}: target must resolve to exactly one object.`);

  const object = objects[0];
  const meshData = object.userData?.meshData;
  if (!editor.modeManager.isValidMesh(object) || !meshData) {
    throw new Error(`${command}: "${label(object)}" is not an editable mesh.`);
  }

  return { object, meshData };
}

export function resolveElementIds(editor, object, value, selectMode, command) {
  const elements = elementsOf(object.userData.meshData, selectMode);

  if (value === 'selected') {
    if (editor.editSelection.editedObject !== object) {
      throw new Error(`${command}: "selected" requires "${label(object)}" to be in edit mode.`);
    }
    return Array.from(editor.editSelection[SELECTED_IDS[selectMode]]);
  }

  if (value === 'all') return Array.from(elements.keys());

  if (Array.isArray(value)) {
    const ids = [...new Set(value)];
    const missing = ids.filter(id => !Number.isInteger(id) || !elements.has(id));
    if (missing.length) throw new Error(`${command}: ${selectMode} id(s) ${missing.join(', ')} do not exist. `);
    return ids;
  }

  throw new Error(`${command}: expected 'selected', 'all', or an array of ${selectMode} ids, got ${JSON.stringify(value)}.`);
}

export const resolveVertexIds = (editor, object, vertices, command) =>
  resolveElementIds(editor, object, vertices, 'vertex', command);

export const resolveEdgeIds = (editor, object, edges, command) =>
  resolveElementIds(editor, object, edges, 'edge', command);

export const resolveFaceIds = (editor, object, faces, command) =>
  resolveElementIds(editor, object, faces, 'face', command);

// mesh data
export const elementsOf = (meshData, selectMode) =>
  ({ vertex: meshData.vertices, edge: meshData.edges, face: meshData.faces })[selectMode];

export function vertexIdsOf(element, selectMode) {
  if (selectMode === 'vertex') return [element.id];
  if (selectMode === 'edge') return [element.v1Id, element.v2Id];
  return element.vertexIds;
}

export function worldPositionLookup(object, meshData = object.userData.meshData) {
  const cache = new Map();
  const matrix = object.matrixWorld;

  return (id) => {
    let p = cache.get(id);
    if (!p) {
      p = new THREE.Vector3().copy(meshData.vertices.get(id).position).applyMatrix4(matrix);
      cache.set(id, p);
    }
    return p;
  };
}

export function faceNormal(object, vertexIds, worldPos) {
  const n = new THREE.Vector3();
  for (let i = 0; i < vertexIds.length; i++) {
    const a = worldPos(vertexIds[i]);
    const b = worldPos(vertexIds[(i + 1) % vertexIds.length]);
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (object.matrixWorld.determinant() < 0) n.negate();
  return n.normalize();
}