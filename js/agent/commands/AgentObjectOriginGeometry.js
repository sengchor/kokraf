import * as THREE from 'three';
import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { SetOriginToGeometryCommand } from '../../commands/SetOriginToGeometryCommand.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionFromThree } from '../AgentAxes.js';

const label = (object) => object.name || object.uuid;

const isGeometryObject = (object) => object?.isMesh && !object.userData?.isImageRef;

function worldBoundsCenter(object) {
  const vertices = object.userData?.meshData?.vertices;
  const box = new THREE.Box3();

  if (vertices?.size) {
    const p = new THREE.Vector3();
    for (const v of vertices.values()) {
      box.expandByPoint(p.copy(v.position).applyMatrix4(object.matrixWorld));
    }
  } else {
    box.setFromObject(object);
  }

  return box.isEmpty() ? null : positionFromThree(box.getCenter(new THREE.Vector3()));
}

const worldOrigin = (object) => positionFromThree(object.getWorldPosition(new THREE.Vector3()));

export const objectOriginGeometrySpec = {
  description:
    AXES_NOTE +
    "Move each mesh's origin to the center of its geometry. The geometry stays where it is in the world; " +
    "the object's position changes and the mesh data is offset to compensate. Use this before rotating or " +
    'scaling so the object pivots about its own center. Mesh objects only. Undoable via the normal history stack.',
  mutates: true,
  params: {
    target: {
      type: 'string|string[]',
      description: 'uuid or object name, or an array of them. Every target must be a mesh.',
    },
  },
  prepare({ target }, editor) {
    const objects = [...new Set(resolveTargets(editor, target))];

    const invalid = objects.filter((object) => !isGeometryObject(object));
    if (invalid.length) {
      throw new Error(
        `object.originToGeometry: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not a mesh. Only mesh objects have geometry to center the origin on.'
      );
    }

    return { objects };
  },
  run(_params, editor, { objects }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const originBefore = new Map(objects.map((object) => [object, worldOrigin(object)]));

    const multi = new SequentialMultiCommand(editor, 'Agent Origin to Geometry');
    for (const object of objects) {
      multi.add(() => new SetOriginToGeometryCommand(editor, object));
    }
    editor.execute(multi);

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    return {
      objects: objects.map((object) => ({
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        originBefore: originBefore.get(object),
        originAfter: worldOrigin(object),
        geometryCenter: worldBoundsCenter(object),
      })),
    };
  },
};