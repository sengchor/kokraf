import * as THREE from 'three';
import { ObjectTransformOps } from '../../operations/ObjectTransformOps.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionFromThree } from '../AgentAxes.js';

const EPSILON_SQ = 1e-12;

export const objectCenterSpec = {
  description:
    AXES_NOTE +
    'Move objects so their origins sit at the world origin [0, 0, 0]. Rotation and scale are untouched, ' +
    'and the geometry moves with the origin. Objects already at the world origin are skipped. ' +
    'Undoable via the normal history stack.',
  mutates: true,
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
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    const toMove = [];
    const skipped = [];

    for (const object of objects) {
      object.getWorldPosition(worldPos);
      (worldPos.lengthSq() > EPSILON_SQ ? toMove : skipped).push(object);
    }

    if (toMove.length) {
      const positions = ObjectTransformOps.resolvePositions(
        toMove,
        new THREE.Vector3(0, 0, 0),
        { relative: false, space: 'world' }
      );

      editor.execute(ObjectTransformOps.createCommand(editor, toMove, { positions }, 'Agent Center'));

      scene.updateMatrixWorld(true);
      editor.signals.objectChanged.dispatch();
    }

    const summarize = (object) => ({
      uuid: object.uuid,
      name: object.name || '(unnamed)',
    });

    return {
      centered: toMove.map(summarize),
      skipped: skipped.map(summarize),
      objects: objects.map((object) => ({
        ...summarize(object),
        worldPosition: positionFromThree(object.getWorldPosition(new THREE.Vector3())),
      })),
    };
  },
};