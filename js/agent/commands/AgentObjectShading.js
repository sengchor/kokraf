import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { SetShadingCommand } from '../../commands/SetShadingCommand.js';
import { resolveTargets } from '../AgentUtils.js';

const SHADING_MODES = ['smooth', 'flat', 'auto'];

const label = (object) => object.name || object.uuid;

const isShadable = (object) => object?.isMesh && !object.userData?.isImageRef;

const currentShading = (object) => object.userData?.shading || 'flat';

export const objectShadingSpec = {
  description:
    "Set mesh shading. 'smooth' interpolates normals across faces for curved surfaces; 'flat' gives each face " +
    "a single normal for a faceted look; 'auto' smooths across shallow edges and keeps sharp edges flat, " +
    'which suits hard-surface models with rounded parts. This only changes how the mesh renders; geometry is untouched. ' +
    'Objects already using the requested shading are skipped. Mesh objects only. Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them. Every target must be a mesh.',
    },
    shading: {
      type: 'string',
      enum: SHADING_MODES,
      description: "'smooth', 'flat' or 'auto'.",
    },
  },
  prepare({ target, shading }, editor) {
    if (!SHADING_MODES.includes(shading)) {
      throw new Error(
        `object.shading: shading must be one of ${SHADING_MODES.map((m) => `'${m}'`).join(', ')}, got ${JSON.stringify(shading)}.`
      );
    }

    const objects = [...new Set(resolveTargets(editor, target))];

    const invalid = objects.filter((object) => !isShadable(object));
    if (invalid.length) {
      throw new Error(
        `object.shading: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not a mesh. Only mesh objects have shading.'
      );
    }

    return { objects };
  },
  run({ shading }, editor, { objects }) {
    const changed = [];
    const unchanged = [];

    for (const object of objects) {
      (currentShading(object) === shading ? unchanged : changed).push(object);
    }

    const before = new Map(changed.map((object) => [object, currentShading(object)]));

    if (changed.length) {
      const multi = new SequentialMultiCommand(editor, `Agent Shade ${shading}`);
      for (const object of changed) {
        multi.add(() => new SetShadingCommand(editor, object, shading, before.get(object)));
      }
      editor.execute(multi);
    }

    const summarize = (object) => ({
      uuid: object.uuid,
      name: object.name || '(unnamed)',
    });

    return {
      shading,
      changed: changed.map((object) => ({
        ...summarize(object),
        from: before.get(object),
        to: currentShading(object),
      })),
      unchanged: unchanged.map(summarize),
    };
  },
};