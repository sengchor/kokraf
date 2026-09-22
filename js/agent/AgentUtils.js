import * as THREE from 'three';

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export function r(n, digits = 4) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export const vec = (v, digits = 4) => [r(v.x, digits), r(v.y, digits), r(v.z, digits)];

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
    position: vec(object.position),
    rotation: [r(object.rotation.x * DEG, 2), r(object.rotation.y * DEG, 2), r(object.rotation.z * DEG, 2)],
    scale: vec(object.scale),
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

export function toScaleVector(scale) {
  return typeof scale === 'number'
    ? new THREE.Vector3(scale, scale, scale)
    : new THREE.Vector3().fromArray(scale);
}

export function resolveVertexIds(editor, object, vertices) {
  if (Array.isArray(vertices)) return vertices;

  if (vertices === 'selected') {
    if (editor.editSelection.editedObject !== object) {
      throw new Error(`edit.transform: "selected" requires "${object.name || object.uuid}" to be in edit mode.`);
    }
    return Array.from(editor.editSelection.selectedVertexIds);
  }

  if (vertices === 'all') {
    return Array.from(object.userData.meshData.vertices.keys());
  }

  throw new Error(`edit.transform: invalid vertices "${vertices}".`);
}