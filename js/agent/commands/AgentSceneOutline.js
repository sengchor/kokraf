import { describeObject } from "../AgentUtils.js";
import { AXES_NOTE } from "../AgentAxes.js";

export const sceneOutlineSpec = {
  description:
    AXES_NOTE +
    'List the objects in the scene with their uuid, type, transform, and vertex/edge/face counts. ' +
    'Counts describe the editable mesh topology, so faces are n-gons, not triangles. ' +
    'Returns no geometry data — use this to find the uuid of an object before acting on it.',
  mutates: false,
  params: {
    root: {
      type: 'string',
      optional: true,
      description: 'uuid of a subtree root. Omit to outline the whole scene.',
    },
    depth: {
      type: 'number',
      default: -1,
      description: 'Maximum depth to descend. -1 for unlimited.',
    },
    includeStats: { type: 'boolean', default: true, description: 'Include vertex/edge/face counts.' },
    includeMaterials: { type: 'boolean', default: false, description: 'Include material names and colors.' },
    maxObjects: { type: 'number', default: 100, description: 'Hard cap on returned objects.' },
  },
  run({ root, depth, includeStats, includeMaterials, maxObjects }, editor) {
    const scene = editor.sceneManager.mainScene;
    const rootObject = root ? scene.getObjectByProperty('uuid', root) : scene;

    if (!rootObject) throw new Error(`No object with uuid "${root}" in the scene.`);

    const objects = [];
    let truncated = false;

    const walk = (object, level) => {
      if (truncated) return;

      if (object !== rootObject) {
        if (object.userData?.isEditorOnly) return;
        if (objects.length >= maxObjects) {
          truncated = true;
          return;
        }
        objects.push(describeObject(object, level, { includeStats, includeMaterials }));
      }

      if (depth !== -1 && level >= depth) return;
      for (const child of object.children) walk(child, level + 1);
    };

    walk(rootObject, 0);

    return {
      sceneUuid: scene.uuid,
      rootUuid: rootObject === scene ? null : rootObject.uuid,
      currentMode: editor.modeManager.currentMode,
      editedObjectUuid: editor.editSelection.editedObject?.uuid ?? null,
      objectCount: objects.length,
      truncated,
      objects,
    };
  },
};