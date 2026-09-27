import * as THREE from 'three';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionToThree, positionFromThree } from '../AgentAxes.js';

const NAME = 'mesh.inspect';
const INCLUDE = ['summary', 'islands', 'selection', 'vertices', 'edges', 'faces'];
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_ISLANDS = 50;
const MAX_GROW = 10;

// Geometry helpers

function toVector3(v) {
  if (v.isVector3) return v.clone();
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return new THREE.Vector3().fromArray(v);
  return new THREE.Vector3(v.x, v.y, v.z);
}

function makeFrame(object, space) {
  if (space === 'local') {
    return { point: (p) => toVector3(p), dir: (d) => toVector3(d).normalize() };
  }
  object.updateWorldMatrix(true, false);
  const matrix = object.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  return {
    point: (p) => toVector3(p).applyMatrix4(matrix),
    dir: (d) => toVector3(d).applyMatrix3(normalMatrix).normalize(),
  };
}

// Newell normal (right-hand rule over vertexIds order) and vertex centroid, in local space.
// Robust for concave and slightly non-planar n-gons.
function faceNormalAndCenter(meshData, face) {
  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const ids = face.vertexIds;
  const n = ids.length;

  for (let i = 0; i < n; i++) {
    const a = meshData.getVertex(ids[i])?.position;
    const b = meshData.getVertex(ids[(i + 1) % n])?.position;
    if (!a || !b) continue;
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
    center.add(a);
  }

  return { normal: normal.normalize(), center: center.divideScalar(n) };
}

// Connected components over edges. Island 0 is the largest; ties broken by lowest vertex id.
function computeIslands(meshData) {
  const parent = new Map();
  for (const id of meshData.vertices.keys()) parent.set(id, id);

  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };

  for (const edge of meshData.edges.values()) {
    if (!parent.has(edge.v1Id) || !parent.has(edge.v2Id)) continue;
    const a = find(edge.v1Id);
    const b = find(edge.v2Id);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }

  const groups = new Map();
  for (const id of meshData.vertices.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }

  const islands = [...groups.values()]
    .map((ids) => ids.sort((a, b) => a - b))
    .sort((a, b) => b.length - a.length || a[0] - b[0]);

  const islandOf = new Map();
  islands.forEach((ids, index) => ids.forEach((id) => islandOf.set(id, index)));

  return { islands, islandOf };
}

// Output formatting

function makeFormatter(precision) {
  const k = 10 ** precision;
  const round = (n) => Math.round(n * k) / k || 0; // `|| 0` folds -0 into 0
  const vec = (v) => positionFromThree(v).map(round);

  // Axis conversion can flip an axis, so re-sort corners after converting.
  const box = (b) => {
    if (b.isEmpty()) return null;
    const a = vec(b.min);
    const c = vec(b.max);
    const min = a.map((x, i) => Math.min(x, c[i]));
    const max = a.map((x, i) => Math.max(x, c[i]));
    return { min, max, size: max.map((x, i) => round(x - min[i])) };
  };

  return { round, vec, box };
}

function page(items, offset, limit) {
  return {
    total: items.length,
    offset,
    truncated: offset + limit < items.length,
    items: items.slice(offset, offset + limit),
  };
}

// Scope

function toFramePoint(value) {
  return positionToThree(value);
}

function resolveScope(editor, object, meshData, frame, islandOf, islandCount, params) {
  const { selected, ids, box, sphere, island, facing, grow } = params;
  const label = object.name || object.uuid;

  const seed = new Set();
  let seeded = false;

  const addEdge = (id) => {
    const edge = meshData.edges.get(id);
    if (!edge) throw new Error(`${NAME}: no edge with id ${id}.`);
    seed.add(edge.v1Id);
    seed.add(edge.v2Id);
  };
  const addFace = (id) => {
    const face = meshData.faces.get(id);
    if (!face) throw new Error(`${NAME}: no face with id ${id}.`);
    face.vertexIds.forEach((v) => seed.add(v));
  };
  const addVertex = (id) => {
    if (!meshData.vertices.has(id)) throw new Error(`${NAME}: no vertex with id ${id}.`);
    seed.add(id);
  };

  if (selected) {
    const { editSelection, modeManager } = editor;
    if (modeManager.currentMode !== 'edit' || editSelection.editedObject !== object) {
      throw new Error(`${NAME}: selected needs "${label}" in Edit Mode. Call edit.select first.`);
    }
    editSelection.selectedVertexIds.forEach(addVertex);
    editSelection.selectedEdgeIds.forEach(addEdge);
    editSelection.selectedFaceIds.forEach(addFace);
    seeded = true;
  }

  if (ids) {
    (ids.vertices ?? []).forEach(addVertex);
    (ids.edges ?? []).forEach(addEdge);
    (ids.faces ?? []).forEach(addFace);
    seeded = true;
  }

  let V = seeded ? seed : new Set(meshData.vertices.keys());
  const keep = (predicate) => {
    for (const id of V) if (!predicate(id)) V.delete(id);
  };
  const framePos = (id) => frame.point(meshData.getVertex(id).position);

  if (island !== undefined) {
    if (!Number.isInteger(island) || island < 0 || island >= islandCount) {
      throw new Error(`${NAME}: island must be an integer 0..${islandCount - 1}.`);
    }
    keep((id) => islandOf.get(id) === island);
  }

  if (box) {
    const bounds = new THREE.Box3().setFromPoints([toFramePoint(box.min), toFramePoint(box.max)]);
    keep((id) => bounds.containsPoint(framePos(id)));
  }

  if (sphere) {
    const center = toFramePoint(sphere.center);
    const r2 = sphere.radius * sphere.radius;
    keep((id) => framePos(id).distanceToSquared(center) <= r2);
  }

  // Face-level filter: keep only faces whose normal points within maxAngle of direction.
  let facingFaces = null;
  if (facing) {
    const direction = positionToThree(facing.direction).normalize();
    const minDot = Math.cos(THREE.MathUtils.degToRad(facing.maxAngle ?? 30));
    facingFaces = new Set();
    const verts = new Set();

    for (const face of meshData.faces.values()) {
      if (!face.vertexIds.every((id) => V.has(id))) continue;
      const normal = frame.dir(faceNormalAndCenter(meshData, face).normal);
      if (normal.dot(direction) >= minDot) {
        facingFaces.add(face.id);
        face.vertexIds.forEach((id) => verts.add(id));
      }
    }
    V = verts;
  }

  // Grow by edge rings so the agent can see the neighbourhood around a region.
  for (let ring = 0; ring < grow; ring++) {
    const added = [];
    for (const id of V) {
      for (const edgeId of meshData.getVertex(id).edgeIds) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;
        const other = edge.v1Id === id ? edge.v2Id : edge.v1Id;
        if (!V.has(other)) added.push(other);
      }
    }
    if (!added.length) break;
    added.forEach((id) => V.add(id));
  }

  const restrictFaces = facingFaces && grow === 0;
  const faceInScope = (face) =>
    face.vertexIds.every((id) => V.has(id)) && (!restrictFaces || facingFaces.has(face.id));

  return { vertexIds: V, faceInScope, filtered: seeded || !!(box || sphere || facing || island !== undefined) };
}

// Sections

function summarize(meshData, frame, fmt, islandCount) {
  const faceSizes = {};
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let wireEdges = 0;
  let looseVertices = 0;
  const bounds = new THREE.Box3();

  for (const face of meshData.faces.values()) {
    const n = face.vertexIds.length;
    faceSizes[n] = (faceSizes[n] ?? 0) + 1;
  }
  for (const edge of meshData.edges.values()) {
    const count = edge.faceIds.size;
    if (count === 0) wireEdges++;
    else if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  for (const vertex of meshData.vertices.values()) {
    if (vertex.edgeIds.size === 0) looseVertices++;
    bounds.expandByPoint(frame.point(vertex.position));
  }

  return {
    vertices: meshData.vertices.size,
    edges: meshData.edges.size,
    faces: meshData.faces.size,
    faceSizes,
    bounds: fmt.box(bounds),
    boundaryEdges,
    nonManifoldEdges,
    wireEdges,
    looseVertices,
    islands: islandCount,
    closed: meshData.faces.size > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && wireEdges === 0,
  };
}

function describeIslands(meshData, islands, frame, fmt) {
  return islands.slice(0, MAX_ISLANDS).map((ids, index) => {
    const bounds = new THREE.Box3();
    const faceIds = new Set();
    for (const id of ids) {
      const vertex = meshData.getVertex(id);
      bounds.expandByPoint(frame.point(vertex.position));
      vertex.faceIds.forEach((f) => faceIds.add(f));
    }
    return { index, vertices: ids.length, faces: faceIds.size, bounds: fmt.box(bounds) };
  });
}

function describeSelection(editor, object, limit) {
  const { editSelection, modeManager } = editor;
  if (modeManager.currentMode !== 'edit' || editSelection.editedObject !== object) return null;

  const list = (set) => {
    const ids = Array.from(set).sort((a, b) => a - b);
    return { total: ids.length, ids: ids.slice(0, limit) };
  };

  return {
    selectionMode: editSelection.subSelectionMode,
    vertices: list(editSelection.selectedVertexIds),
    edges: list(editSelection.selectedEdgeIds),
    faces: list(editSelection.selectedFaceIds),
  };
}

// Command spec

export const meshInspectSpec = {
  description:
    AXES_NOTE +
    'Read-only view of a mesh\'s editable topology (n-gons, not triangles). Works in any mode; does not change mode or selection. ' +
    "Start with include ['summary', 'islands'] to see size, bounds, face-size histogram, open/non-manifold edges " +
    'and separate parts. Then narrow the scope with island, box, sphere, facing, ids or selected (filters combine as AND), ' +
    'and use grow to add N edge-rings of neighbours. Lists are compact tuples: ' +
    'vertices [id, x, y, z, valence]; edges [id, v1, v2, faceCount] (0 = wire, 1 = open border, 2 = manifold, 3+ = non-manifold); ' +
    'faces [id, [vertexIds], [nx, ny, nz], [cx, cy, cz]] where vertexIds wind counter-clockwise around the normal. ' +
    'Edges and faces are listed only when all their vertices are in scope. Page long lists with offset/limit. ' +
    'Ids feed edit.select, edit.transform and edit.loopCut.',
  mutates: false,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    include: {
      type: 'string[]',
      default: ['summary'],
      description: `Sections to return: ${INCLUDE.join(', ')}. summary and islands always cover the whole mesh.`,
    },
    space: {
      type: 'string',
      enum: ['world', 'local'],
      default: 'world',
      description: 'Frame for positions, normals, bounds, and the box/sphere/facing filters.',
    },
    selected: { type: 'boolean', default: false, description: 'Scope to the current edit selection (target must be in Edit Mode).' },
    ids: {
      type: 'object',
      optional: true,
      description: 'Scope to specific elements: { vertices?: number[], edges?: number[], faces?: number[] }.',
    },
    island: { type: 'number', optional: true, description: 'Scope to one connected part, by index from the islands section.' },
    box: { type: 'object', optional: true, description: 'Scope to vertices inside { min: [x, y, z], max: [x, y, z] }.' },
    sphere: { type: 'object', optional: true, description: 'Scope to vertices inside { center: [x, y, z], radius }.' },
    facing: {
      type: 'object',
      optional: true,
      description: 'Scope to faces whose normal is within maxAngle degrees of direction: { direction: [x, y, z], maxAngle?: 30 }.',
    },
    grow: { type: 'number', default: 0, description: `Expand the scope by this many edge-rings (0–${MAX_GROW}).` },
    offset: { type: 'number', default: 0, description: 'Skip this many items in each list (paging).' },
    limit: { type: 'number', default: DEFAULT_LIMIT, description: `Max items per list (1–${MAX_LIMIT}).` },
    precision: { type: 'number', default: 4, description: 'Decimal places for coordinates (0–8).' },
  },

  run(params, editor) {
    const { target, include, space, grow, offset, limit, precision } = params;

    const unknown = include.filter((s) => !INCLUDE.includes(s));
    if (unknown.length) throw new Error(`${NAME}: unknown include ${unknown.join(', ')}. Valid: ${INCLUDE.join(', ')}.`);
    if (!Number.isInteger(grow) || grow < 0 || grow > MAX_GROW) throw new Error(`${NAME}: grow must be 0–${MAX_GROW}.`);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`${NAME}: limit must be 1–${MAX_LIMIT}.`);
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`${NAME}: offset must be a non-negative integer.`);
    if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error(`${NAME}: precision must be 0–8.`);

    const objects = resolveTargets(editor, target);
    if (objects.length !== 1) throw new Error(`${NAME}: target must resolve to exactly one object.`);
    const object = objects[0];
    const meshData = object.userData?.meshData;
    if (!editor.modeManager.isValidMesh(object) || !meshData) {
      throw new Error(`${NAME}: "${object.name || object.uuid}" is not an editable mesh.`);
    }

    const frame = makeFrame(object, space);
    const fmt = makeFormatter(precision);
    const { islands, islandOf } = computeIslands(meshData);
    const want = new Set(include);

    const result = { uuid: object.uuid, name: object.name || '(unnamed)', space };

    if (want.has('summary')) result.summary = summarize(meshData, frame, fmt, islands.length);

    if (want.has('islands')) {
      result.islands = describeIslands(meshData, islands, frame, fmt);
      if (islands.length > MAX_ISLANDS) result.islandsTruncated = true;
    }

    if (want.has('selection')) result.selection = describeSelection(editor, object, limit);

    if (want.has('vertices') || want.has('edges') || want.has('faces')) {
      const scope = resolveScope(editor, object, meshData, frame, islandOf, islands.length, params);

      if (want.has('vertices')) {
        const items = [...scope.vertexIds].sort((a, b) => a - b).map((id) => {
          const vertex = meshData.getVertex(id);
          return [id, ...fmt.vec(frame.point(vertex.position)), vertex.edgeIds.size];
        });
        result.vertices = page(items, offset, limit);
      }

      if (want.has('edges')) {
        const items = [];
        for (const edge of meshData.edges.values()) {
          if (scope.vertexIds.has(edge.v1Id) && scope.vertexIds.has(edge.v2Id)) {
            items.push([edge.id, edge.v1Id, edge.v2Id, edge.faceIds.size]);
          }
        }
        items.sort((a, b) => a[0] - b[0]);
        result.edges = page(items, offset, limit);
      }

      if (want.has('faces')) {
        const items = [];
        for (const face of meshData.faces.values()) {
          if (!scope.faceInScope(face)) continue;
          const { normal, center } = faceNormalAndCenter(meshData, face);
          items.push([face.id, [...face.vertexIds], fmt.vec(frame.dir(normal)), fmt.vec(frame.point(center))]);
        }
        items.sort((a, b) => a[0] - b[0]);
        result.faces = page(items, offset, limit);
      }
    }

    return result;
  },
};