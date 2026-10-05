import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { SetVisibilityCommand } from '../../commands/SetVisibilityCommand.js';
import { resolveTargets } from '../AgentUtils.js';

const summarize = (object) => ({
  uuid: object.uuid,
  name: object.name || '(unnamed)',
});

function ancestorsOf(object) {
  const result = [];
  for (let p = object.parent; p && !p.isScene; p = p.parent) result.push(p);
  return result;
}

function descendantsOf(object) {
  const result = [];
  object.traverse((child) => {
    if (child !== object) result.push(child);
  });
  return result;
}

const isEffectivelyVisible = (object) =>
  object.visible && ancestorsOf(object).every((a) => a.visible);

function applyVisibility(editor, objects, visible, name) {
  const toChange = objects.filter((object) => object.visible !== visible);

  if (toChange.length) {
    const multi = new SequentialMultiCommand(editor, name);
    for (const object of toChange) {
      multi.add(() => new SetVisibilityCommand(editor, object, visible));
    }
    editor.execute(multi);
    editor.toolbar.updateTools();
  }

  return toChange;
}

function dropHiddenFromSelection(editor) {
  const selected = editor.selection.selectedObjects ?? [];
  const remaining = selected.filter(isEffectivelyVisible);
  if (remaining.length === selected.length) return;

  if (remaining.length) editor.selection.select(remaining);
  else editor.selection.deselect();
}

export const objectHideSpec = {
  description:
    'Hide objects in the viewport. Hiding an object also hides its children. Hidden objects stay in the scene ' +
    '(scene.outline marks them visible: false) and are removed from the selection. With invert: true, hides ' +
    'everything EXCEPT the targets, their children and their parents, to isolate them. ' +
    'Undoable as a single step; use object.unhide to reverse.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them.',
    },
    invert: {
      type: 'boolean',
      default: false,
      description: 'true hides every other object instead, isolating the targets.',
    },
  },
  prepare({ target, invert = false }, editor) {
    const targets = [...new Set(resolveTargets(editor, target))];
    if (!invert) return { objects: targets };

    // Hiding a target's parent would hide the target too, so keep the whole chain visible.
    const keep = new Set();
    for (const object of targets) {
      keep.add(object);
      ancestorsOf(object).forEach((a) => keep.add(a));
      descendantsOf(object).forEach((d) => keep.add(d));
    }

    return {
      objects: editor.sceneManager.getSceneObjects().filter((object) => !keep.has(object)),
    };
  },
  run({ invert = false }, editor, { objects }) {
    const hidden = applyVisibility(editor, objects, false, invert ? 'Agent Hide Others' : 'Agent Hide');
    dropHiddenFromSelection(editor);

    const hiddenSet = new Set(hidden);
    return {
      invert,
      hidden: hidden.map(summarize),
      alreadyHidden: objects.filter((o) => !hiddenSet.has(o)).map(summarize),
    };
  },
};

export const objectUnhideSpec = {
  description:
    'Unhide objects. Omit target to unhide every object in the scene. An object whose parent is still hidden ' +
    'stays invisible; those are listed in stillHidden along with the parent to unhide. ' +
    'Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      optional: true,
      description: 'uuid or object name, or an array of them. Omit to unhide everything.',
    },
  },
  prepare({ target }, editor) {
    const objects = target === undefined
      ? editor.sceneManager.getSceneObjects()
      : [...new Set(resolveTargets(editor, target))];

    return { objects };
  },
  run({ target }, editor, { objects }) {
    const shown = applyVisibility(editor, objects, true, target === undefined ? 'Agent Unhide All' : 'Agent Unhide');

    const result = { unhidden: shown.map(summarize) };

    const stillHidden = objects
      .filter((object) => !isEffectivelyVisible(object))
      .map((object) => ({
        ...summarize(object),
        hiddenBy: ancestorsOf(object).find((a) => !a.visible)?.uuid ?? null,
      }));

    if (stillHidden.length) result.stillHidden = stillHidden;
    return result;
  },
};