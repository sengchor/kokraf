import { getManifoldWasm, toManifold, fromManifoldResult } from '../geometry/MeshDataManifold.js';
import { RemoveObjectCommand } from '../commands/RemoveObjectCommand.js';
import { IntersectCommand } from '../commands/IntersectCommand.js';
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';

export class IntersectOps {
  constructor(editor) {
    this.editor = editor;
  }

  /**
   * Intersect `primary` with `secondary`, replace primary's mesh with the result and remove
   * `secondary`, as one undoable step. Returns true on success, false if the inputs are invalid.
   * Throws if the boolean fails.
   */
  async intersect(primary, secondary) {
    const computed = await this.compute(primary, secondary);
    if (!computed) return false;

    this.commit(primary, secondary, computed);
    return true;
  }

  // Step 1 (async): compute the result without touching the scene. Null if the inputs are invalid.
  async compute(primary, secondary) {
    if (!IntersectOps.canIntersect(primary, secondary)) return null;

    // Clone before any await so the undo state is the mesh as it was when the user confirmed
    const beforeMeshData = structuredClone(primary.userData.meshData);
    const resultMeshData = await IntersectOps.computeIntersection(primary, secondary);

    return { beforeMeshData, resultMeshData };
  }

  // Step 2 (sync): apply a computed result as one undoable step.
  commit(primary, secondary, { beforeMeshData, resultMeshData }) {
    this.editor.execute(
      IntersectOps.createCommand(this.editor, primary, secondary, beforeMeshData, resultMeshData)
    );
  }

  // Non-interactive helpers.

  static canIntersect(primary, secondary) {
    return !!primary?.userData?.meshData
      && !!secondary?.userData?.meshData
      && primary !== secondary;
  }

  // Returns the MeshData for primary ∩ secondary, keeping face ids traceable to both inputs.
  static async computeIntersection(primary, secondary) {
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
      result = manifoldA.intersect(manifoldB);
      return fromManifoldResult(result.getMesh(), faceIdMapA, faceIdMapB, primary);
    } finally {
      // Manifold objects live in WASM memory and aren't garbage collected.
      result?.delete?.();
    }
  }

  static createCommand(editor, primary, secondary, beforeMeshData, resultMeshData) {
    const multi = new SequentialMultiCommand(editor, 'Intersect Objects');
    multi.add(() => new IntersectCommand(editor, primary, beforeMeshData, resultMeshData));
    multi.add(() => new RemoveObjectCommand(editor, secondary));
    return multi;
  }
}