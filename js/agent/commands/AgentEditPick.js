import * as THREE from 'three';
import { AXES_NOTE, r, positionFromThree } from '../AgentAxes.js';
import { resolveMeshTarget, worldPositionLookup, faceNormal } from '../AgentUtils.js';
import { SwitchSubModeCommand } from '../../commands/SwitchSubModeCommand.js';

const HIT_SAMPLE = 10;
const ID_SAMPLE = 50;

const SELECTED_IDS = { vertex: 'selectedVertexIds', edge: 'selectedEdgeIds', face: 'selectedFaceIds' };

const fail = (msg) => {
  throw new Error(`edit.pick: ${msg}`);
};

const label = (object) => object.name || object.uuid;

function captureCamera(capture) {
  const camera = capture.camera.clone();
  const aspect = capture.width / capture.height;
 
  if (camera.isPerspectiveCamera) {
    camera.aspect = aspect;
  } else if (camera.isOrthographicCamera) {
    const halfHeight = (camera.top - camera.bottom) / 2;
    const centerX = (camera.left + camera.right) / 2;
    camera.left = centerX - halfHeight * aspect;
    camera.right = centerX + halfHeight * aspect;
  }
  camera.updateProjectionMatrix();
 
  capture.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrixWorld(true);
 
  return camera;
}
 
function toNdc(capture, x, y) {
  return [(x / capture.width) * 2 - 1, -(y / capture.height) * 2 + 1];
}
 
function validatePixels(name, values, count, capture) {
  if (!Array.isArray(values) || values.length !== count || !values.every(Number.isFinite)) {
    fail(`${name} must be an array of ${count} numbers in image pixels.`);
  }
  for (let i = 0; i < count; i += 2) {
    const [x, y] = [values[i], values[i + 1]];
    if (x < 0 || x > capture.width || y < 0 || y > capture.height) {
      fail(`${name} [${x}, ${y}] is outside the ${capture.width}x${capture.height} capture.`);
    }
  }
}
 
function rectFrustum(camera, capture, [x1, y1, x2, y2]) {
  const [ax, ay] = toNdc(capture, x1, y1);
  const [bx, by] = toNdc(capture, x2, y2);
 
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const bottom = Math.min(ay, by);
  const top = Math.max(ay, by);
 
  if (right - left < 1e-6 || top - bottom < 1e-6) fail('rect has zero area.');
 
  const matrix = new THREE.Matrix4()
    .set(
      2 / (right - left), 0, 0, -(right + left) / (right - left),
      0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom),
      0, 0, 1, 0,
      0, 0, 0, 1
    )
    .multiply(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse);
 
  return new THREE.Frustum().setFromProjectionMatrix(matrix);
}

function makeProjector(camera, capture) {
  const v = new THREE.Vector3();
  return (p) => {
    v.copy(p).project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * capture.width, y: ((1 - v.y) / 2) * capture.height, depth: v.z };
  }
}

// Edit Selection
function applySelection(selection, selectMode, ids) {
  if (!ids.length) {
    selection.clearSelection();
    return;
  }

  const previousMulti = selection.multiSelectEnabled;
  selection.multiSelectEnabled = false;
  try {
    if (selectMode === 'vertex') selection.selectVertices(ids);
    else if (selectMode === 'edge') selection.selectEdges(ids);
    else selection.selectFaces(ids);
  } finally {
    selection.multiSelectEnabled = previousMulti;
  }
}

function filterVisible(ctx, selectMode, candidates) {
  if (ctx.xray || !candidates.length) return candidates;

  const selection = ctx.editor.editSelection;
  if (selectMode === 'vertex') return selection.filterVisibleVertices(candidates, ctx.camera);
  if (selectMode === 'edge') return selection.filterVisibleEdges(candidates, ctx.camera);
  return selection.filterVisibleFaces(candidates, ctx.camera);
}

function buildFaces(object, meshData, worldPos) {
  const faces = [];

  for (const face of meshData.faces.values()) {
    if (face.vertexIds.length < 3) continue;

    const normal = faceNormal(object, face.vertexIds, worldPos);
    if (normal.lengthSq() === 0) continue;

    const points = face.vertexIds.map(worldPos);
    const centroid = new THREE.Vector3();
    for (const p of points) centroid.add(p);
    centroid.divideScalar(points.length);

    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    const [u, v] = ax >= ay && ax >= az ? ['y', 'z'] : ay >= az ? ['z', 'x'] : ['x', 'y'];

    faces.push({
      id: face.id,
      points,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centroid),
      u,
      v,
    });
  }

  return faces;
}

function pointInPolygon(p, { points, u, v }) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a[v] > p[v]) !== (b[v] > p[v]) && p[u] < ((b[u] - a[u]) * (p[v] - a[v])) / (b[v] - a[v]) + a[u]) {
      inside = !inside;
    }
  }
  return inside;
}

function rayFaceHits(ray, faces) {
  const hits = [];
  const point = new THREE.Vector3();
 
  for (const face of faces) {
    if (!ray.intersectPlane(face.plane, point)) continue;
    if (!pointInPolygon(point, face)) continue;
    hits.push({
      id: face.id,
      distance: ray.origin.distanceTo(point),
      point: point.clone(),
      vertices: face.points,
    });
  }
 
  return hits.sort((a, b) => a.distance - b.distance);
}

// Picking
function segmentDistance2D(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
 
const byScreenThenDepth = (a, b) => a.pixelDistance - b.pixelDistance || a.depth - b.depth;
 
function pickPoint(ctx, selectMode, [x, y]) {
  const { camera, capture, meshData, worldPos, faces, project, xray, radius } = ctx;
 
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(...toNdc(capture, x, y)), camera);
  const pickRay = raycaster.ray;
 
  if (selectMode === 'face') {
    const hits = rayFaceHits(pickRay, faces);
    return filterVisible(ctx, 'face', xray ? hits : hits.slice(0, 1));
  }
 
  const pixel = { x, y };
  const candidates = [];
 
  if (selectMode === 'vertex') {
    for (const vertex of meshData.vertices.values()) {
      const point = worldPos(vertex.id);
      const screen = project(point);
      if (!screen) continue;
 
      const pixelDistance = Math.hypot(screen.x - x, screen.y - y);
      if (pixelDistance <= radius) {
        candidates.push({ id: vertex.id, point, pixelDistance, depth: screen.depth });
      }
    }
  } else {
    for (const edge of meshData.edges.values()) {
      const vA = worldPos(edge.v1Id);
      const vB = worldPos(edge.v2Id);
      const sa = project(vA);
      const sb = project(vB);
      if (!sa || !sb) continue;
 
      const pixelDistance = segmentDistance2D(pixel, sa, sb);
      if (pixelDistance > radius) continue;
 
      const point = new THREE.Vector3();
      pickRay.distanceSqToSegment(vA, vB, undefined, point);
      candidates.push({ id: edge.id, vA, vB, point, pixelDistance, depth: project(point)?.depth ?? 1 });
    }
  }
 
  return filterVisible(ctx, selectMode, candidates).sort(byScreenThenDepth);
}
 
function pickRect(ctx, selectMode, rect) {
  const { editor, camera, capture, meshData, worldPos, faces } = ctx;
  const frustum = rectFrustum(camera, capture, rect);
  const box = editor.selectionBox;
 
  if (selectMode === 'vertex') {
    const candidates = [];
    for (const vertex of meshData.vertices.values()) {
      const point = worldPos(vertex.id);
      if (frustum.containsPoint(point)) candidates.push({ id: vertex.id, point });
    }
    return filterVisible(ctx, selectMode, candidates).map((c) => c.id);
  }
 
  if (selectMode === 'edge') {
    const candidates = [];
    for (const edge of meshData.edges.values()) {
      const vA = worldPos(edge.v1Id);
      const vB = worldPos(edge.v2Id);
      const enclosed = frustum.containsPoint(vA) && frustum.containsPoint(vB);
      if (enclosed || box.edgeClipsFrustum(vA, vB, frustum)) {
        candidates.push({ id: edge.id, vA, vB, type: enclosed ? 'endpoint' : 'clipping' });
      }
    }
 
    // Like viewport box select: fully enclosed edges win; crossing edges count only when none are enclosed.
    const visible = filterVisible(ctx, selectMode, candidates);
    const enclosed = visible.filter((c) => c.type === 'endpoint');
    return (enclosed.length ? enclosed : visible).map((c) => c.id);
  }
 
  const candidates = faces
    .filter((face) => box.faceClipsFrustum(face.points, frustum))
    .map((face) => ({ id: face.id, vertices: face.points }));
  return filterVisible(ctx, selectMode, candidates).map((c) => c.id);
}

export const editPickSpec = {
  description:
    AXES_NOTE +
    'Pick vertices, edges or faces of a mesh from the most recent viewport.capture image, ' +
    'like clicking or box-selecting in Edit Mode. Coordinates are image pixels from the top-left of that capture, ' +
    'so call viewport.capture first and again after the view changes. ' +
    'point picks near a pixel: vertices/edges within radius pixels, nearest on screen first; ' +
    'faces under the pixel, front to back (faces behind the front one need xray). hit chooses which to pick (0 = first). ' +
    'rect picks every element inside [x1, y1, x2, y2]; for edges, fully enclosed edges win over ones that only cross it. ' +
    'Without xray, anything hidden in the rendered view, by this mesh or other objects, is skipped. ' +
    'xray defaults to the viewport X-ray setting. ' +
    'op "none" only reports what is there without changing the selection.',
  mutates: false,
  params: {
    target: {
      type: 'string',
      optional: true,
      description: 'uuid or name of a mesh to pick on. Defaults to the mesh already in Edit Mode.',
    },
    selectMode: {
      type: 'string',
      enum: ['vertex', 'edge', 'face'],
      optional: true,
      description: 'Element type to pick. Defaults to the current selection mode.',
    },
    point: { type: 'number[]', optional: true, description: '[x, y] pixel in the last capture.' },
    rect: { type: 'number[]', optional: true, description: '[x1, y1, x2, y2] pixel corners in the last capture.' },
    hit: { type: 'number', default: 0, description: 'point only: which candidate to pick, 0 = first.' },
    radius: {
      type: 'number',
      default: 12,
      description: 'point only: pixel distance within which vertices and edges count as under the point.',
    },
    xray: {
      type: 'boolean',
      optional: true,
      description: 'Include hidden elements. Defaults to the viewport X-ray setting.',
    },
    op: {
      type: 'string',
      enum: ['set', 'add', 'subtract', 'none'],
      default: 'set',
      description: 'Replace the selection, add to it, remove from it, or only report the picked elements.',
    },
  },
 
  prepare({ target, point, rect, hit, radius }, editor) {
    const capture = editor.agentCapture;
    if (!capture) fail('no capture to pick from. Call viewport.capture first.');
 
    if ((point === undefined) === (rect === undefined)) fail('pass exactly one of point or rect.');
    if (point !== undefined) validatePixels('point', point, 2, capture);
    if (rect !== undefined) validatePixels('rect', rect, 4, capture);
    if (!Number.isInteger(hit) || hit < 0) fail(`hit must be a non-negative integer (got ${hit}).`);
    if (!(radius > 0)) fail(`radius must be greater than 0 (got ${radius}).`);
 
    let object;
    if (target !== undefined) {
      ({ object } = resolveMeshTarget(editor, target, 'edit.pick'));
    } else {
      object = editor.editSelection.editedObject;
      if (!object || editor.modeManager.currentMode !== 'edit') {
        fail('no mesh is in Edit Mode. Pass target to pick on a mesh.');
      }
    }
 
    return { modeTarget: object, object, capture };
  },
 
  run({ selectMode: requestedMode, point, rect, hit, radius, xray: requestedXray, op }, editor, { object, capture }) {
    const selection = editor.editSelection;
    if (selection.editedObject !== object) fail(`could not enter Edit Mode on "${label(object)}".`);
 
    const selectMode = requestedMode ?? selection.subSelectionMode;
    if (!SELECTED_IDS[selectMode]) fail(`unknown selection mode "${selectMode}".`);
 
    const xray = requestedXray ?? !!editor.sceneManager.xrayMode;
 
    editor.sceneManager.mainScene.updateMatrixWorld(true);
 
    const camera = captureCamera(capture);
    const meshData = object.userData.meshData;
    const worldPos = worldPositionLookup(object, meshData);
 
    const ctx = {
      editor,
      camera,
      capture,
      meshData,
      worldPos,
      faces: selectMode === 'face' ? buildFaces(object, meshData, worldPos) : null,
      project: makeProjector(camera, capture),
      xray,
      radius,
    };
 
    let hits = null;
    let picked;
    if (point) {
      hits = pickPoint(ctx, selectMode, point);
      picked = hits[hit] ? [hits[hit].id] : [];
    } else {
      picked = pickRect(ctx, selectMode, rect);
    }
 
    if (op !== 'none') {
      if (selection.subSelectionMode !== selectMode) {
        editor.execute(new SwitchSubModeCommand(editor, selectMode, selection.subSelectionMode));
      }
 
      const current = selection[SELECTED_IDS[selectMode]];
      const next = op === 'set' ? new Set(picked) : new Set(current);
      if (op === 'add') picked.forEach((id) => next.add(id));
      if (op === 'subtract') picked.forEach((id) => next.delete(id));
 
      applySelection(selection, selectMode, [...next]);
    }
 
    const result = {
      uuid: object.uuid,
      name: object.name || 'unnamed',
      selectMode,
      xray,
      capture: `${capture.width}x${capture.height}`,
      picked: picked.slice(0, ID_SAMPLE),
      pickedTruncated: picked.length > ID_SAMPLE,
      selected: {
        vertices: selection.selectedVertexIds.size,
        edges: selection.selectedEdgeIds.size,
        faces: selection.selectedFaceIds.size,
      },
    };
 
    if (hits) {
      result.hits = hits.slice(0, HIT_SAMPLE).map((h, index) => {
        const entry = { index, id: h.id };
        if (h.pixelDistance !== undefined) entry.pixelDistance = r(h.pixelDistance, 1);
        if (h.distance !== undefined) entry.distance = r(h.distance, 3);
        entry.point = positionFromThree(h.point);
        return entry;
      });
    }
 
    return result;
  },
};