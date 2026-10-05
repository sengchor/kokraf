import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { RemoveObjectCommand } from '../../commands/RemoveObjectCommand.js';
import { resolveTargets } from '../AgentUtils.js';

const label = (object) => object.name || object.uuid;

const summarize = (object) => ({
  uuid: object.uuid,
  name: object.name || '(unnamed)',
  type: object.type,
});

function hasAncestorIn(object, set) {
  for (let p = object.parent; p; p = p.parent) {
    if (set.has(p)) return true;
  }
  return false;
}

function descendantsOf(object) {
  const result = [];
  object.traverse((child) => {
    if (child !== object) result.push(child);
  });
  return result;
}

const isDefaultCamera = (object) => object.isCamera && !!object.isDefault;

export const objectDeleteSpec = {
  description:
    'Delete objects from the scene. Deleting an object also deletes all of its children. ' +
    'The result lists every uuid that no longer exists, children included; do not use them afterwards. ' +
    'The default camera cannot be deleted, directly or as a child. Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them.',
    },
  },
  prepare({ target }, editor) {
    const resolved = new Set(resolveTargets(editor, target));

    // Children go with their parent, so only remove the topmost targets.
    const roots = [...resolved].filter((object) => !hasAncestorIn(object, resolved));

    for (const root of roots) {
      const camera = [root, ...descendantsOf(root)].find(isDefaultCamera);
      if (camera) {
        throw new Error(
          camera === root
            ? `object.delete: "${label(root)}" is the default camera and cannot be deleted.`
            : `object.delete: "${label(root)}" contains the default camera "${label(camera)}" and cannot be deleted. ` +
              'Move the camera out of it first.'
        );
      }
    }

    return { roots };
  },
  run(_params, editor, { roots }) {
    const deleted = roots.map((root) => ({
      ...summarize(root),
      children: descendantsOf(root).map(summarize),
    }));

    const multi = new SequentialMultiCommand(
      editor,
      roots.length > 1 ? `Agent Delete ${roots.length} Objects` : 'Agent Delete'
    );
    for (const root of roots) {
      multi.add(() => new RemoveObjectCommand(editor, root));
    }
    editor.execute(multi);

    return {
      deleted,
      removedUuids: deleted.flatMap((entry) => [entry.uuid, ...entry.children.map((c) => c.uuid)]),
    };
  },
};