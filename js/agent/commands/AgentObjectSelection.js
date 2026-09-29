import * as THREE from 'three';
import { positionFromThree } from '../AgentAxes.js';
import { resolveTargets } from '../AgentUtils.js';

const ID_SAMPLE = 50;

const fail = (msg) => {
  throw new Error(`object.select: ${msg}`);
};

const label = (object) => object.name || object.uuid;

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

function isPickable(object) {
  if (object.isScene) return false;
  if (object.userData.selectable === false) return false;
  for (let o = object; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

function selectionBounds(selection) {
  const roots = selection.getRootSelectedObjects();
  if (!roots.length) return null;

  const box = new THREE.Box3();
  for (const object of roots) box.expandByObject(object);
  if (box.isEmpty()) return null;

  return { min: positionFromThree(box.min), max: positionFromThree(box.max) };
}

export const objectSelectSpec = {
  description:
    'Select objects in Object Mode (leaves Edit Mode if active). ' +
    'Targets are uuids or names. ' +
    'Pass targets: [] to clear the selection, or all: true to select every visible, selectable object.',
  mutates: false,
  params: {
    targets: { type: 'string[]', optional: true, description: 'uuids or names of objects.' },
    all: { type: 'boolean', default: false, description: 'Select every visible, seleable object.' },
    op: {
      type: 'string',
      enum: ['set', 'add', 'subtract'],
      default: 'set',
      description: 'Replace the current selection, add to it, or remove from it.',
    },
  },

  prepare({ targets, all }, editor) {
    const scene = editor.sceneManager.mainScene;

    if (targets === undefined && !all) fail('supply targets or all: true. To clear, pass targets: [].');
    if (targets !== undefined && all) fail('pass either targets or all, not both.');

    let objects;
    if (all) {
      objects = [];
      scene.traverseVisible((child) => {
        if (child !== scene && child.userData.selectable !== false) objects.push(child);
      });
    } else if (targets.length === 0) {
      objects = [];
    } else {
      objects = [...new Set(resolveTargets(editor, targets))];
      const blocked = objects.filter((o) => !isPickable(o));
      if (blocked.length) {
        fail(`not selectable (hidden, locked or the scene root): ${blocked.slice(0, 10).map(label).join(', ')}.`);
      }
    }

    return { objects };
  },

  run({ op }, editor, { objects }) {
    const selection = editor.selection;
    const current = selection.selectedObjects;
    const picked = new Set(objects);

    let next;
    if (op === 'add') next = [...current, ...objects.filter((o) => !current.includes(o))];
    else if (op === 'subtract') next = current.filter((o) => !picked.has(o));
    else next = objects;

    applySelection(selection, next);
    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const selected = selection.selectedObjects;

    return {
      matched: objects.length,
      count: selected.length,
      objects: selected.slice(0, ID_SAMPLE).map((o) => ({
        uuid: o.uuid,
        name: o.name || 'unnamed',
        type: o.type,
      })),
      objectsTruncated: selected.length > ID_SAMPLE,
      pivot: selection.pivotHandle.visible ? positionFromThree(selection.pivotHandle.position) : null,
      bounds: selectionBounds(selection),
    };
  },
};