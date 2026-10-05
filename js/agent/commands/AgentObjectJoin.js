import * as THREE from 'three';
import { JoinObjectsCommand } from '../../commands/JoinObjectsCommand.js';
import { resolveTargets, meshStats } from '../AgentUtils.js';
import { AXES_NOTE, positionFromThree } from '../AgentAxes.js';

const label = (object) => object.name || object.uuid;

const isJoinable = (object) =>
  object?.isMesh && !object.userData?.isImageRef && !!object.userData?.meshData;

const summarize = (object) => ({
  uuid: object.uuid,
  name: object.name || '(unnamed)',
  stats: meshStats(object),
});

export const objectJoinSpec = {
  description:
    AXES_NOTE +
    'Join two or more mesh objects into a single mesh object. Geometry keeps its world-space placement. ' +
    'The source objects are replaced by the joined result, so their uuids may no longer be valid afterwards: ' +
    'use the uuid returned in "result" for follow-up commands. Mesh objects only. Undoable as a single step.',
  mutates: true,
  params: {
    target: {
      type: 'string[]',
      description: 'Array of at least two uuids or object names. Every target must be an editable mesh.',
    },
  },
  prepare({ target }, editor) {
    const objects = [...new Set(resolveTargets(editor, target))];

    if (objects.length < 2) {
      throw new Error(
        `object.join: need at least two distinct objects, got ${objects.length}. ` +
        'Pass an array of uuids or names.'
      );
    }

    const invalid = objects.filter((object) => !isJoinable(object));
    if (invalid.length) {
      throw new Error(
        `object.join: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not an editable mesh. Only mesh objects can be joined.'
      );
    }

    return { objects };
  },
  run(_params, editor, { objects }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const sources = objects.map(summarize);
    const expected = sources.reduce(
      (sum, { stats }) => ({
        vertices: sum.vertices + (stats?.vertices ?? 0),
        faces: sum.faces + (stats?.faces ?? 0),
      }),
      { vertices: 0, faces: 0 }
    );

    const joined = editor.objectEditor.joinObjects(objects);
    if (!joined) {
      throw new Error('object.join: the editor could not join these objects.');
    }

    editor.execute(new JoinObjectsCommand(editor, objects, joined));

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    const stats = meshStats(joined);

    return {
      result: {
        ...summarize(joined),
        worldPosition: positionFromThree(joined.getWorldPosition(new THREE.Vector3())),
        reusedSource: objects.includes(joined),
      },
      sources,
      expected,
      complete: !!stats && stats.vertices === expected.vertices && stats.faces === expected.faces,
    };
  },
};