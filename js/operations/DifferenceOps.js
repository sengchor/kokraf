import { getManifoldWasm, toManifold, fromManifoldResult } from '../geometry/MeshDataManifold.js';
import { RemoveObjectCommand } from '../commands/RemoveObjectCommand.js';
import { DifferenceCommand } from '../commands/DifferenceCommand.js';
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';

export class DifferenceOps {
  constructor(editor) {
    this.editor = editor;
  }

  /**
   * Subtract `secondary` from `primary`, replace primary's mesh with the result and remove
   * `secondary`, as one undoable step. Returns true on success, false if the inputs are invalid.
   * Throws if the boolean fails.
   */
  async difference(primary, secondary) {
    const computed = await this.compute(primary, secondary);
    if (!computed) return false;

    this.commit(primary, secondary, computed);
    return true;
  }

  // Step 1 (async): compute the result without touching the scene. Null if the inputs are invalid.
  async compute(primary, secondary) {
    if (!DifferenceOps.canDifference(primary, secondary)) return null;

    // Clone before any await so the undo state is the mesh as it was when the user confirmed
    const beforeMeshData = structuredClone(primary.userData.meshData);
    const resultMeshData = await DifferenceOps.computeDifference(primary, secondary);

    return { beforeMeshData, resultMeshData };
  }

  // Step 2 (sync): apply a computed result as one undoable step.
  commit(primary, secondary, { beforeMeshData, resultMeshData }) {
    this.editor.execute(
      DifferenceOps.createCommand(this.editor, primary, secondary, beforeMeshData, resultMeshData)
    );
  }

  // Non-interactive helpers.

  static canDifference(primary, secondary) {
    return !!primary?.userData?.meshData
      && !!secondary?.userData?.meshData
      && primary !== secondary;
  }

  // Returns the MeshData for primary − secondary, keeping face ids traceable to both inputs.
  static async computeDifference(primary, secondary) {
    const meshData = primary.userData.meshData;
    const idOffsetB = meshData.nextFaceId + meshData.vertices.size;

    await getManifoldWasm();

    const [
      { manifold: manifoldA, faceIdMap: faceIdMapA },
      { manifold: manifoldB, faceIdMap: faceIdMapB },
    ] = await Promise.all([
      toManifold(primary, 0),
      toManifold(secondary, idOffsetB),
    ]);

    let result = null;
    try {
      result = manifoldA.subtract(manifoldB);
      return fromManifoldResult(result.getMesh(), faceIdMapA, faceIdMapB, primary);
    } finally {
      // Manifold objects live in WASM memory and aren't garbage collected.
      result?.delete?.();
    }
  }

  static createCommand(editor, primary, secondary, beforeMeshData, resultMeshData) {
    const multi = new SequentialMultiCommand(editor, 'Difference Objects');
    multi.add(() => new DifferenceCommand(editor, primary, beforeMeshData, resultMeshData));
    multi.add(() => new RemoveObjectCommand(editor, secondary));
    return multi;
  }
}