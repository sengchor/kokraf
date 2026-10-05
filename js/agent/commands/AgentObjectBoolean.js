import { UnionOps } from '../../operations/UnionOps.js';
import { DifferenceOps } from '../../operations/DifferenceOps.js';
import { IntersectOps } from '../../operations/IntersectOps.js';
import { resolveTargets, meshStats } from '../AgentUtils.js';
import { AXES_NOTE } from '../AgentAxes.js';

const label = (object) => object.name || object.uuid;

const summarize = (object) => ({
  uuid: object.uuid,
  name: object.name || '(unnamed)',
});

const isBooleanMesh = (object) =>
  object?.isMesh && !object.userData?.isImageRef && !!object.userData?.meshData;

const faceCount = (meshData) => meshData?.faces?.size ?? meshData?.faces?.length ?? 0;

function isAncestorOf(ancestor, object) {
  for (let p = object.parent; p; p = p.parent) {
    if (p === ancestor) return true;
  }
  return false;
}

function isInScene(object, scene) {
  for (let p = object; p; p = p.parent) {
    if (p === scene) return true;
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

function snapshot(object) {
  return {
    meshData: object.userData.meshData,
    stats: JSON.stringify(meshStats(object)),
    matrix: object.matrixWorld.clone(),
  };
}

function unchangedSince(object, snap) {
  return object.userData.meshData === snap.meshData
    && JSON.stringify(meshStats(object)) === snap.stats
    && object.matrixWorld.equals(snap.matrix);
}

function resolveOne(editor, key, command, role) {
  const objects = resolveTargets(editor, key);
  if (objects.length !== 1) {
    throw new Error(`${command}: ${role} must resolve to exactly one object.`);
  }

  const object = objects[0];
  if (!isBooleanMesh(object)) {
    throw new Error(`${command}: ${role} "${label(object)}" is not an editable mesh.`);
  }
  return object;
}

function defineBooleanSpec({ command, summary, operandDescription, emptyMessage, compute, createCommand }) {
  return {
    description:
      AXES_NOTE +
      summary +
      "The target's mesh is replaced by the result; it keeps its uuid and transform. The operand and any " +
      'children it has are deleted. Both must be closed, watertight meshes. One operand per call; chain calls ' +
      'to combine more. Undoable as a single step.',
    mutates: true,
    params: {
      target: {
        type: 'string',
        description: 'uuid or name of the object to keep. Its mesh is replaced by the result.',
      },
      operand: {
        type: 'string',
        description: operandDescription,
      },
    },
    prepare({ target, operand }, editor) {
      const primary = resolveOne(editor, target, command, 'target');
      const secondary = resolveOne(editor, operand, command, 'operand');

      if (primary === secondary) {
        throw new Error(`${command}: target and operand are the same object.`);
      }

      if (isAncestorOf(secondary, primary)) {
        throw new Error(
          `${command}: "${label(secondary)}" is a parent of "${label(primary)}"; removing it would delete the ` +
          'target too. Move the target out of it first.'
        )
      }

      return { primary, secondary};
    },
    async run(_params, editor, { primary, secondary }) {
      const scene = editor.sceneManager.mainScene;
      scene.updateMatrixWorld(true);

      const primarySnap = snapshot(primary);
      const secondarySnap = snapshot(secondary);
      const statsBefore = meshStats(primary);
      const operandStats = meshStats(secondary);

      const beforeMeshData = structuredClone(primary.userData.meshData);
      let resultMeshData;
      try {
        resultMeshData = await compute(primary, secondary);
      } catch (error) {
        throw new Error(
          `${command}: the boolean failed (${error?.message ?? error}). Both meshes must be closed, ` +
          'watertight solids without self-intersections. Nothing was changed.'
        );
      }

      scene.updateMatrixWorld(true);
      if (
        !isInScene(primary, scene) || !isInScene(secondary, scene)
        || !unchangedSince(primary, primarySnap) || !unchangedSince(secondary, secondarySnap)
      ) {
        throw new Error(`${command}: the scene changed while the boolean was computing. Nothing was applied; try again.`);
      }

      if (!faceCount(resultMeshData)) {
        throw new Error(`${command}: ${emptyMessage} Nothing was changed.`);
      }

      const removed = [secondary, ...descendantsOf(secondary)].map(summarize);

      editor.execute(createCommand(editor, primary, secondary, beforeMeshData, resultMeshData));

      scene.updateMatrixWorld(true);
      editor.signals.objectChanged.dispatch();

      return {
        result: {
          ...summarize(primary),
          statsBefore,
          statsAfter: meshStats(primary),
        },
        operand: { ...summarize(secondary), stats: operandStats },
        removedUuids: removed.map((entry) => entry.uuid),
      };
    },
  };
}

export const objectUnionSpec = defineBooleanSpec({
  command: 'object.union',
  summary:
    'Merge the operand into the target as one solid (target ∪ operand). Overlapping volume is fused and the ' +
    'faces inside it are removed. ',
  operandDescription: 'uuid or name of the mesh to merge in. It is deleted afterwards.',
  emptyMessage: 'the union came out empty.',
  compute: UnionOps.computeUnion,
  createCommand: UnionOps.createCommand,
});

export const objectDifferenceSpec = defineBooleanSpec({
  command: 'object.difference',
  summary:
    'Cut the operand out of the target (target − operand). The operand acts as a cutter: transform it so it ' +
    'overlaps the target where material should be removed. ',
  operandDescription: 'uuid or name of the cutter mesh. It is deleted afterwards.',
  emptyMessage: 'the operand completely encloses the target, so the result would be empty.',
  compute: DifferenceOps.computeDifference,
  createCommand: DifferenceOps.createCommand,
});

export const objectIntersectSpec = defineBooleanSpec({
  command: 'object.intersect',
  summary: 'Keep only the volume shared by the target and the operand (target ∩ operand). ',
  operandDescription: 'uuid or name of the mesh to intersect with. It is deleted afterwards.',
  emptyMessage: "the objects don't overlap, so the intersection would be empty.",
  compute: IntersectOps.computeIntersection,
  createCommand: IntersectOps.createCommand,
});