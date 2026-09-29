import * as THREE from 'three';
import { AXES_NOTE, r, positionFromThree } from '../AgentAxes.js';

const HIT_SAMPLE = 10;
const ID_SAMPLE = 50;

const fail = (msg) => {
  throw new Error(`object.pick: ${msg}`);
};

const summarize = (object) => ({ uuid: object.uuid, name: object.name || 'unnamed', type: object.type });

function applySelection(selection, objects) {
  if (!objects.length) {
    selection.deselect();
    return;
  }

  const previousMulti  = selection.multiSelectEnabled;
  selection.multiSelectEnabled = false;
  try {
    selection.select(objects);
  } finally {
    selection.multiSelectEnabled = previousMulti;
  }
}

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

  camera.matrixAutoUpdate = false;
  camera.matrixWorld.copy(capture.matrixWorld);
  camera.matrixWorldInverse.copy(capture.matrixWorld).invert();

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

function uniqueTargets(objects) {
  const seen = new Set();
  const result = [];
  for (const entry of objects) {
    const object = entry.object.userData.object || entry.object;
    if (seen.has(object)) continue;
    seen.add(object);
    result.push({ ...entry, object });
  }
  return result;
}

function pickPoint(editor, camera, capture, [x, y]) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(...toNdc(capture, x, y)), camera);

  const hits = raycaster.intersectObjects(editor.selection.getPickableObjects(), false);
  return uniqueTargets(hits);
}

function pickRect(editor, camera, capture, [x1, y1, x2, y2]) {
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

  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const hits = editor.selectionBox.getObjectsInFrustum(editor.selection.getPickableObjects(), frustum) ?? [];

  return uniqueTargets(hits);
}

export const objectPickSpec = {
  description:
    AXES_NOTE +
    'Pick objects from the most recent viewport.capture image, like clicking or box-selecting in the viewport. ' +
    'Coordinates are image pixels from the top-left of that capture, so call viewport.capture first. ' +
    'point picks the object under a pixel (hit chooses which surface along the ray, 0 = nearest); ' +
    'rect picks every object inside [x1, y1, x2, y2]. ' +
    'op "none" only reports what is there without changing the selection. ' +
    'Picking empty space with op "set" clears the selection, as a click would.',
  mutates: false,
  params: {
    point: { type: 'number[]', optional: true, description: '[x, y] pixel in the last capture.' },
    rect: { type: 'number[]', optional: true, description: '[x1, y1, x2, y2] pixel corners in the last capture.' },
    hit: {
      type: 'number',
      default: 0,
      description: 'point only: which object along the ray to pick, 0 = nearest, 1 = the one behind it, ...',
    },
    op: {
      type: 'string',
      enum: ['set', 'add', 'subtract', 'none'],
      default: 'set',
      description: 'Replace the selection, add to it, remove from it, or only report the picked objects.',
    },
  },

  prepare({ point, rect, hit }, editor) {
    const capture = editor.agentCapture;
    if (!capture) fail('no capture to pick from. Call viewport.capture first.');

    if ((point === undefined) === (rect === undefined)) fail('pass exactly one of point or rect.');
    if (point !== undefined) validatePixels('point', point, 2, capture);
    if (rect !== undefined) validatePixels('rect', rect, 4, capture);
    if (!Number.isInteger(hit) || hit < 0) fail(`hit must be a non-negative integer (got ${hit}).`);

    return { capture };
  },

  run({ point, rect, hit, op }, editor, { capture }) {
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const camera = captureCamera(capture);
    const hits = point ? pickPoint(editor, camera, capture, point) : pickRect(editor, camera, capture, rect);

    const picked = point ? (hits[hit] ? [hits[hit].object] : []) : hits.map((h) => h.object);

    const selection = editor.selection;
    if (op !== 'none') {
      const current = selection.selectedObjects;
      const pickedSet = new Set(picked);

      let next;
      if (op === 'add') next = [...current, ...picked.filter((o) => !current.includes(o))];
      else if (op === 'subtract') next = current.filter((o) => !pickedSet.has(o));
      else next = picked;

      applySelection(selection, next);
    }

    const selected = selection.selectedObjects;

    const result = {
      capture: `${capture.width}x${capture.height}`,
      picked: picked.slice(0, ID_SAMPLE).map(summarize),
      pickedTruncated: picked.length > ID_SAMPLE,
      selected: {
        count: selected.length,
        objects: selected.slice(0, ID_SAMPLE).map(summarize),
        truncated: selected.length > ID_SAMPLE,
      },
    };

    if (point) {
      result.hits = hits.slice(0, HIT_SAMPLE).map((h, index) => ({
        index,
        ...summarize(h.object),
        distance: r(h.distance, 3),
        point: positionFromThree(h.point),
      }));
    }

    return result;
  },
};