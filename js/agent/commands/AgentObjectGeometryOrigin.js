import * as THREE from 'three';
import { SequentialMultiCommand } from '../../commands/SequentialMultiCommand.js';
import { SetGeometryToOriginCommand } from '../../commands/SetGeometryToOriginCommand.js';
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

export const objectGeometryOriginSpec = {
  description:
    AXES_NOTE +
    "Move each mesh's geometry so it is centred on the object's own origin. The object's position, " +
    'rotation and scale are unchanged; only the mesh data shifts. Use this when the origin is where you ' +
    'want the object to be and the geometry should follow. Mesh objects only. Undoable via the normal history stack.',
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
        `object.geometryToOrigin: ${invalid.map((o) => `"${label(o)}"`).join(', ')} ` +
        'not a mesh. Only mesh objects have geometry to move.'
      );
    }

    return { objects };
  },
  run(_params, editor, { objects }) {
    const scene = editor.sceneManager.mainScene;
    scene.updateMatrixWorld(true);

    const before = new Map(objects.map((object) => [object, worldBoundsCenter(object)]));

    const multi = new SequentialMultiCommand(editor, 'Agent Geometry to Origin');
    for (const object of objects) {
      multi.add(() => new SetGeometryToOriginCommand(editor, object));
    }
    editor.execute(multi);

    scene.updateMatrixWorld(true);
    editor.signals.objectChanged.dispatch();

    return {
      objects: objects.map((object) => ({
        uuid: object.uuid,
        name: object.name || '(unnamed)',
        origin: positionFromThree(object.getWorldPosition(new THREE.Vector3())),
        geometryCenterBefore: before.get(object),
        geometryCenterAfter: worldBoundsCenter(object),
      })),
    };
  },
};