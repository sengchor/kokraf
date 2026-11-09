import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { SetShadingCommand } from '../../commands/SetShadingCommand.js';
import { ShadingUtils } from '../../utils/ShadingUtils.js';
import { resolveTargets } from '../AgentUtils.js';

const SHADING_MODES = ['smooth', 'flat', 'auto'];

const label = (object) => object.name || object.uuid;

const isShadable = (object) => object?.isMesh && !object.userData?.isImageRef;

const sameState = (a, b) => a?.mode === b?.mode && a?.angle === b?.angle;

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
    angle: {
      type: 'number',
      optional: true,
      description: "Auto-smooth angle threshold, used with 'auto'. Omit to keep the object's current angle.",
    },
  },
  prepare({ target, shading, angle }, editor) {
    if (!SHADING_MODES.includes(shading)) {
      throw new Error(
        `object.shading: shading must be one of ${SHADING_MODES.map((m) => `'${m}'`).join(', ')}, got ${JSON.stringify(shading)}.`
      );
    }

    if (angle !== undefined && !Number.isFinite(angle)) {
      throw new Error(`object.shading: angle must be a finite number, got ${JSON.stringify(angle)}.`);
    }

    const objects = [...new Set(resolveTargets(editor, target))];

    const invalid = objects.filter((object) => !isShadable(object));
    if (invalid.length) {
      throw new Error(
        `object.shading: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not a mesh. Only mesh objects have shading.'
      );
    }

    const patch = angle === undefined ? { mode: shading } : { mode: shading, angle };

    return { objects, patch };
  },
  run({ shading }, editor, { objects, patch }) {
    const changed = [];
    const unchanged = [];
    const before = new Map();

    for (const object of objects) {
      const current = ShadingUtils.getShading(object);
      const target = ShadingUtils.normalize({ ...current, ...patch });

      if (sameState(current, target)) {
        unchanged.push(object);
      } else {
        before.set(object, current);
        changed.push(object);
      }
    }

    if (changed.length) {
      const multi = new SequentialMultiCommand(editor, `Agent Shade ${shading}`);
      for (const object of changed) {
        multi.add(() => new SetShadingCommand(editor, object, patch));
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
        to: ShadingUtils.getShading(object),
      })),
      unchanged: unchanged.map(summarize),
    };
  },
};