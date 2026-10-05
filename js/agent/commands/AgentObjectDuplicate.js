import * as THREE from 'three';
import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { DuplicateObjectCommand } from '../../commands/DuplicateObjectCommand.js';
import { ObjectTransformOps } from '../../operations/ObjectTransformOps.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionToThree, positionFromThree } from '../AgentAxes.js';

const MAX_COUNT = 100;

const summarize = (object) => ({
  uuid: object.uuid,
  name: object.name || '(unnamed)',
});

function hasAncestorIn(object, set) {
  for (let p = object.parent; p; p = p.parent) {
    if (set.has(p)) return true;
  }
  return false;
}

export const objectDuplicateSpec = {
  description:
    AXES_NOTE +
    'Duplicate objects. Each copy is an independent object placed exactly on its source unless offset is given. ' +
    'With count > 1 and an offset, copy i is moved by offset × i, producing a linear array. ' +
    "Children are duplicated along with their parent. Returns the new objects' uuids for follow-up commands. " +
    'Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them.',
    },
    count: {
      type: 'integer',
      default: 1,
      description: `Number of copies of each target (1–${MAX_COUNT}).`,
    },
    offset: {
      type: 'vec3',
      optional: true,
      description: 'World-space [x, y, z] in metres. Copy i is moved by offset × i from its source.',
    },
  },
  prepare({ target, count = 1, offset }, editor) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      throw new Error(`object.duplicate: count must be an integer from 1 to ${MAX_COUNT}, got ${JSON.stringify(count)}.`);
    }

    if (offset !== undefined && !(Array.isArray(offset) && offset.length === 3 && offset.every(Number.isFinite))) {
      throw new Error(`object.duplicate: offset must be [x, y, z] numbers, got ${JSON.stringify(offset)}.`);
    }

    const resolved = new Set(resolveTargets(editor, target));

    // A child whose ancestor is also targeted is already cloned with that ancestor.
    const objects = [];
    const skipped = [];
    for (const object of resolved) {
      (hasAncestorIn(object, resolved) ? skipped : objects).push(object);
    }

    return { objects, skipped };
  },
  run({ count = 1, offset }, editor, { objects, skipped }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const step = offset ? positionToThree(offset) : null;
    const batches = [];

    const multi = new SequentialMultiCommand(
      editor,
      count > 1 ? `Agent Duplicate ×${count}` : 'Agent Duplicate'
    );

    for (let i = 1; i <= count; i++) {
      const batch = { index: i, duplicates: [] };
      batches.push(batch);

      // Create each batch lazily so name generation sees the previous batch in the scene.
      multi.add(() => {
        batch.duplicates = editor.objectEditor.duplicateObjects(objects);
        return new DuplicateObjectCommand(editor, objects, batch.duplicates);
      });

      if (step) {
        multi.add(() => {
          scene.updateMatrixWorld(true);
          const positions = ObjectTransformOps.resolvePositions(
            batch.duplicates,
            step.clone().multiplyScalar(i),
            { relative: true, space: 'world' }
          );
          return ObjectTransformOps.createCommand(editor, batch.duplicates, { positions }, 'Agent Duplicate Offset');
        });
      }
    }

    editor.execute(multi);

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    const result = {
      count,
      offset: offset ?? null,
      sources: objects.map(summarize),
      duplicates: batches.flatMap(({ index, duplicates }) =>
        duplicates.map((duplicate, j) => ({
          ...summarize(duplicate),
          source: objects[j]?.uuid ?? null,
          copy: index,
          worldPosition: positionFromThree(duplicate.getWorldPosition(new THREE.Vector3())),
        }))
      ),
    };

    if (skipped.length) {
      result.skipped = skipped.map((object) => ({
        ...summarize(object),
        reason: 'duplicated as part of an ancestor that is also a target',
      }));
    }

    return result;
  },
};