import * as THREE from 'three';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionFromThree } from '../AgentAxes.js';

const label = (object) => object.name || object.uuid;

export const objectCopySpec = {
  description:
    "Copy objects to the editor clipboard. This replaces whatever the user had copied. The scene is not changed. " +
    "Copying a child also copies its parent chain, so the pasted hierarchy matches; a copied object's children " +
    'are NOT copied unless they are targets too. Supports meshes, lights, cameras, groups and image references. ' +
    'Follow with object.paste. To copy objects within the same scene, prefer object.duplicate.',
  mutates: false,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them.',
    },
  },
  prepare({ target }, editor) {
    return { objects: [...new Set(resolveTargets(editor, target))] };
  },
  run(_params, editor, { objects }) {
    const clipboard = editor.clipboardManager;
    const previous = clipboard.memoryPayload;

    clipboard.copyObjects(objects);

    const payload = clipboard.memoryPayload;
    if (!payload || payload === previous) {
      throw new Error(
        `object.copy: none of ${objects.map((o) => `"${label(o)}"`).join(', ')} can be copied. ` +
        'Only meshes, lights, cameras, groups and image references are supported. The clipboard was left unchanged.'
      );
    }

    const targetIds = new Set(objects.map((o) => o.uuid));
    const copiedIds = new Set(payload.data.map((item) => item.id));

    const result = {
      copied: payload.data.map((item) => ({
        uuid: item.id,
        name: item.name || '(unnamed)',
        type: item.type,
        parent: item.parentId,
        ...(targetIds.has(item.id) ? {} : { addedAsAncestor: true }),
      })),
    };

    const skipped = objects.filter((o) => !copiedIds.has(o.uuid));
    if (skipped.length) {
      result.skipped = skipped.map((o) => ({ uuid: o.uuid, name: o.name || '(unnamed)', type: o.type }));
    }

    return result;
  },
};

export const objectPasteSpec = {
  description:
    AXES_NOTE +
    'Paste the objects on the editor clipboard into the scene as new objects with new uuids, at the transforms ' +
    'they were copied with. Hierarchy is rebuilt among the pasted objects. The pasted objects become the selection. ' +
    'Fails if the clipboard holds no objects. Undoable as a single step.',
  mutates: true,
  params: {},
  run(_params, editor) {
    const created = editor.clipboardManager.pasteObjects() ?? [];
    if (!created.length) {
      throw new Error('object.paste: the clipboard holds no objects. Call object.copy first.');
    }

    editor.sceneManager.mainScene.updateMatrixWorld(true);
    const createdSet = new Set(created);

    return {
      pasted: created.map((object) => ({
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        type: object.type,
        parent: createdSet.has(object.parent) ? object.parent.uuid : null,
        worldPosition: positionFromThree(object.getWorldPosition(new THREE.Vector3())),
      })),
    };
  },
};