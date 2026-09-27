import { LoopCutOps } from '../../operations/LoopCutOps.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE } from '../AgentAxes.js';

const MAX_CUTS = 64;

function resolveStartEdge(edtior, object, edge) {
  const meshData = object.userData.meshData;

  if (edge === undefined) {
    const { editSelection, modeManager } = edtior;
    const inEdit = modeManager.currentMode === 'edit' && editSelection.editedObject === object;
    const selected = inEdit ? Array.from(editSelection.selectedEdgeIds) : [];

    if (selected.length !== 1) {
      throw new Error(
        'edit.loopCut: pass edge, or have exactly one edge selected on the target in Edit Mode ' + '(found ${selected.length}).'
      );
    }
    return meshData.edges.get(selected[0]) ?? null;
  }

  if (typeof edge === 'number') {
    const found = meshData.edges.get(edge);
    if (!found) throw new Error(`edit.loopCut: no edge with id ${edge}.`);
    return found;
  }

  if (Array.isArray(edge) && edge.length === 2) {
    const [v1, v2] = edge;
    if (!meshData.getVertex(v1) || !meshData.getVertex(v2)) {
      throw new Error(`edit.loopCut: vertex ids [${v1}, ${v2}] do not both exist.`);
    }
    const found = meshData.getEdge(v1, v2);
    if (!found) throw new Error(`edit.loopCut: vertices ${v1} and ${v2} are not connected by an edge.`);
    return found;
  }

  throw new Error('edit.loopCut: edge must be an edge id or a [vertexId, vertexId] pair.');
}

export const editLoopCutSpec = {
  description:
    AXES_NOTE +
    'Insert evenly spaced edge loops through a ring of quads (loop cut). ' +
    'The cut crosses the given edge and every edge opposite it across neighbouring quads. ' +
    'so the new edges run PERPENDICULAR to the given edge (e.g. a vertical side edge of a cube ' +
    'gives a horizontal loop around its sides). The ring stops at non-quad faces and open borders. ' +
    'Pass edge as an edge id or a [vertexId, vertexId] pair; omit it to use the single selected edge. ' +
    'Afterwards the new loop is selected in vertex/edge mode (cleared in face mode). Undoable as one step.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    edge: {
      type: 'number|number[]',
      optional: true,
      description: 'Edge id, or [vertexId, vertexId] of an edge the cut should cross.',
    },
    cuts: {
      type: 'number',
      default: 1,
      description: `Number of loops to insert, evenly spaced (1-${MAX_CUTS}).`,
    },
  },

  prepare({ target, edge, cuts }, editor) {
    if (!Number.isInteger(cuts) || cuts < 1 || cuts > MAX_CUTS) {
      throw new Error(`edit.loopCut: cuts must be an integer between 1 and ${MAX_CUTS}.`);
    }

    const objects = resolveTargets(editor, target);
    if (objects.length !== 1) throw new Error('edit.loopCut: target must resolve to exactly one object.');
    const object = objects[0];
    const label = object.name || object.uuid;

    if (!editor.modeManager.isValidMesh(object)) {
      throw new Error(`edit.loopCut: "${label}" is not an editable mesh.`);
    }

    const startEdge = resolveStartEdge(editor, object, edge);
    if (!startEdge) throw new Error('edit.loopCut: selected edge no longer exists.');

    const loopEdges = LoopCutOps.getLoopEdges(object.userData.meshData, startEdge);
    if (loopEdges.length < 2) {
      throw new Error(
        `edit.loopCut: edge ${startEdge.id} has no quad ring to cut through (its neighbouring faces are not quad).`
      );
    }

    return { modeTarget: object, object, startEdge, loopEdges };
  },

  run({ cuts }, editor, { object, startEdge, loopEdges }) {
    const closed = LoopCutOps.isClosedLoop(loopEdges);
    const ringEdges = closed ? loopEdges.length - 1 : loopEdges.length;

    const result = new LoopCutOps(editor).cut(object, loopEdges, cuts);
    if (!result) throw new Error('edit.loopCut: nothing was cut.');

    editor.signals.objectChanged.dispatch();

    const subMode = editor.editSelection.subSelectionMode;

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      startEdge: startEdge.id,
      cuts,
      closed,
      ringEdges,
      created: {
        vertices: result.newVertexIds.length,
        loopEdges: result.newEdgeIds.length,
      },
      selected: subMode === 'face' ? 'none' : `new loop (${subMode}s)`,
    };
  },
};