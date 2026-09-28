import * as THREE from 'three';
import { EdgeSlideOps } from '../../operations/EdgeSlideOps.js';
import { MeshDataRegion } from '../../core/MeshDataRegion.js';
import { resolveMeshTarget, resolveEdgeIds } from '../AgentUtils.js';
import { AXES_NOTE, positionToThree } from '../AgentAxes.js';

const CMD = 'edit.edgeSlide';

export const editEdgeSlideSpec = {
  description:
    AXES_NOTE +
    'Slide edges sideways across their faces without changing topology (edge slide). ' +
    'Each chain of the given edges moves as a unit: every chain vertex slides `factor` of the way along its rail ' +
    'toward the neighbouring edge loop on the side `toward` points at. ' +
    'toward is a vertex id (e.g. a vertex on the loop to slide toward) or a world-space [x, y, z]. ' +
    'Edges must form simple chains (no vertex joining 3+ of them); slide branching selections one chain at a time. ' +
    "edges defaults to 'selected', which only works if the target is ALREADY in Edit Mode; otherwise pass edge ids. " +
    'Undoable as one step; the slid edges stay selected.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    edges: {
      anyOf: [
        { type: 'string', enum: ['selected'] },
        { type: 'array', items: { type: 'integer' } },
      ],
      optional: true,
      description: "'selected' or an array of edge ids. Default: \"selected\".",
    },
    factor: {
      type: 'number',
      description: 'Fraction of the way to the neighbouring edge loop, 0 < factor <= 1.',
    },
    toward: {
      anyOf: [
        { type: 'integer' },
        { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      ],
      description: 'Vertex id or world-space [x, y, z] on the side to slide toward.',
    },
  },

  // Everything is computed here (pure reads), so invalid input is rejected before the mode switch and any change.
  prepare({ target, edges = 'selected', factor, toward }, editor) {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > 1) {
      throw new Error(`${CMD}: factor must be a number greater than 0 and at most 1.`);
    }
    if (toward === undefined) {
      throw new Error(`${CMD}: toward is required (a vertex id or world-space [x, y, z] on the side to slide toward).`);
    }

    const { object, meshData } = resolveMeshTarget(editor, target, CMD);
    const label = object.name || object.uuid;

    editor.sceneManager.mainScene.updateMatrixWorld(true);
    const towardPoint = resolvePoint(meshData, object.matrixWorld, toward);

    const edgeIds = resolveEdgeIds(editor, object, edges, CMD);
    if (!edgeIds.length) throw new Error(`${CMD}: no edges to slide on "${label}".`);

    const slide = EdgeSlideOps.buildSlideData(editor.vertexEditor, object, 'edge', [], edgeIds);
    if (!slide) {
      throw new Error(
        `${CMD}: these edges cannot slide. They must form simple chains (no vertex joining 3+ of them); ` +
          'slide branching selections one chain at a time.'
      );
    }

    const side = pickSide(slide, towardPoint);
    if (!side) {
      throw new Error(`${CMD}: no side of the edges points toward the given target. Check toward.`);
    }

    const { vertexIds, positions } = EdgeSlideOps.computeEdgeSlidePositions(slide, factor, side.name);

    return {
      modeTarget: object,
      object,
      edgeIds,
      vertexIds,
      positions,
      slidVertexCount: side.railCount,
    };
  },

  run({ factor }, editor, { object, edgeIds, vertexIds, positions, slidVertexCount }) {
    const meshData = object.userData.meshData;
    const { vertexEditor, editSelection } = editor;

    // Same undo region as the interactive session: the slid elements plus two rings around them.
    const regionIds = MeshDataRegion.expand(meshData, { vertexIds, edgeIds, faceIds: [] }, 2);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, regionIds);
    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    vertexEditor.setObject(object);

    try {
      vertexEditor.transform.setVertexPositions(vertexIds, positions);
    } catch (error) {
      MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
      vertexEditor.applyDelta(beforeSnapshot);
      editor.signals.editSelectionRefresh.dispatch();
      throw error;
    }

    editor.add(EdgeSlideOps.createCommand(editor, object, beforeSnapshot, startElements));

    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    editSelection.clearSelection();
    editSelection.selectEdges(edgeIds);
    editor.signals.editSelectionRefresh.dispatch();
    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      factor,
      edgeCount: edgeIds.length,
      vertexIds,
      slidVertexCount,
      selected: 'the slid edges',
    };
  },
};

// The side (sideA / sideB) whose rails, summed over the chains, point most toward the target.
// Returns null if neither side has rails or neither points toward it.
function pickSide(slide, point) {
  const sides = {
    sideA: { name: 'sideA', score: 0, railCount: 0 },
    sideB: { name: 'sideB', score: 0, railCount: 0 },
  };

  for (const data of slide.slideData.values()) {
    const dir = point.clone().sub(data.origin);
    const hasDir = dir.lengthSq() > 1e-12;
    if (hasDir) dir.normalize();

    for (const side of Object.values(sides)) {
      const rail = data[side.name];
      if (!rail) continue;

      side.railCount++;
      if (hasDir) side.score += dir.dot(rail.normalized);
    }
  }

  const best = [sides.sideA, sides.sideB]
    .filter(side => side.railCount > 0)
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 1e-9 ? best : null;
}

function resolvePoint(meshData, matrixWorld, value) {
  if (typeof value === 'number') {
    const vertex = meshData.getVertex(value);
    if (!vertex) throw new Error(`${CMD}: toward vertex ${value} does not exist.`);
    return new THREE.Vector3().copy(vertex.position).applyMatrix4(matrixWorld);
  }

  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) {
    return new THREE.Vector3().copy(positionToThree(value));
  }

  throw new Error(`${CMD}: toward must be a vertex id or a world-space [x, y, z].`);
}