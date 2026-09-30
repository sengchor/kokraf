import * as THREE from 'three';
import { AXES_NOTE, positionFromThree } from '../AgentAxes.js';
import { resolveMeshTarget, elementsOf, vertexIdsOf, worldPositionLookup } from '../AgentUtils.js';
import { SwitchSubModeCommand } from '../../commands/SwitchSubModeCommand.js';

const ID_SAMPLE = 50;
const ISLAND_SAMPLE = 10;

const SELECTED_IDS = { vertex: 'selectedVertexIds', edge: 'selectedEdgeIds', face: 'selectedFaceIds' };

const fail = (msg) => {
  throw new Error(`edit.selectLinked: ${msg}`);
};

const label = (object) => object.name || object.uuid;

function applySelection(selection, selectMode, ids) {
  if (!ids.length) {
    selection.clearSelection();
    return;
  }

  const previousMulti = selection.multiSelectEnabled;
  selection.multiSelectEnabled = false;
  try {
    if (selectMode === 'vertex') selection.selectVertices(ids);
    else if (selectMode === 'edge') selection.selectEdges(ids);
    else selection.selectFaces(ids);
  } finally {
    selection.multiSelectEnabled = previousMulti;
  }
}

// Vertex ids touched by elements of the given type.
function seedVertices(meshData, selectMode, ids) {
  const elements = elementsOf(meshData, selectMode);
  const vertices = new Set();
  for (const id of ids) {
    const element = elements.get(id);
    if (!element) continue;
    for (const vertexId of vertexIdsOf(element, selectMode)) vertices.add(vertexId);
  }
  return vertices;
}

// One vertex set per connected island that contains a seed.
function islandsFrom(linker, meshData, seeds) {
  const islands = [];
  const covered = new Set();

  for (const seed of seeds) {
    if (covered.has(seed)) continue;
    const island = linker.selectVertexLinked(meshData, [seed]);
    for (const id of island) covered.add(id);
    islands.push(island);
  }

  return { islands, covered };
}

// Every element of the selectMode type inside the linked vertex set.
// An island is closed under edges, so one endpoint (or corner) decides membership.
function elementsInIslands(meshData, selectMode, vertexSet) {
  if (selectMode === 'vertex') return [...vertexSet];

  const ids = [];
  if (selectMode === 'edge') {
    for (const edge of meshData.edges.values()) {
      if (vertexSet.has(edge.v1Id)) ids.push(edge.id);
    }
  } else {
    for (const face of meshData.faces.values()) {
      if (vertexSet.has(face.vertexIds[0])) ids.push(face.id);
    }
  }
  return ids;
}

function islandBounds(island, worldPos) {
  const box = new THREE.Box3();
  for (const id of island) box.expandByPoint(worldPos(id));
  return { min: positionFromThree(box.min), max: positionFromThree(box.max) };
}

export const editSelectLinkedSpec = {
  description:
    AXES_NOTE +
    'Select everything connected to the seed elements, like Select Linked in the viewport. ' +
    'Seeds are ids of the selectMode type, or the current selection when ids is omitted. ' +
    'Reports the islands the seeds belong to (vertex count and bounds each) and meshIslands, ' +
    'the total number of loose parts in the mesh, which is useful before separating a mesh.',
  mutates: false,
  params: {
    target: {
      type: 'string',
      optional: true,
      description: 'uuid or name of a mesh. Defaults to the mesh already in Edit Mode.',
    },
    selectMode: {
      type: 'string',
      enum: ['vertex', 'edge', 'face'],
      optional: true,
      description: 'Element type of ids and of the resulting selection. Defaults to the current selection mode.',
    },
    ids: {
      type: 'number[]',
      optional: true,
      description: 'Seed element ids of the selectMode type. Defaults to the current selection.',
    },
    op: {
      type: 'string',
      enum: ['set', 'add', 'subtract'],
      default: 'set',
      description: 'Replace the selection with the linked elements, add them, or remove them.',
    },
  },

  prepare({ target }, editor) {
    let object;
    if (target !== undefined) {
      ({ object } = resolveMeshTarget(editor, target, 'edit.selectLinked'));
    } else {
      object = editor.editSelection.editedObject;
      if (!object || editor.modeManager.currentMode !== 'edit') {
        fail('no mesh is in Edit Mode. Pass target to select on a mesh.');
      }
    }

    return { modeTarget: object, object };
  },

  run({ selectMode: requestedMode, ids, op }, editor, { object }) {
    const selection = editor.editSelection;
    if (selection.editedObject !== object) fail(`could not enter Edit Mode on "${label(object)}".`);

    const selectMode = requestedMode ?? selection.subSelectionMode;
    if (!SELECTED_IDS[selectMode]) fail(`unknown selection mode "${selectMode}".`);

    const linker = editor.vertexEditor?.selection;
    if (typeof linker?.selectVertexLinked !== 'function') fail('select linked is not available.');

    const meshData = object.userData.meshData;

    let seeds;
    if (ids !== undefined) {
      const elements = elementsOf(meshData, selectMode);
      const missing = ids.filter((id) => !elements.has(id));
      if (missing.length) fail(`no ${selectMode} with id ${missing.slice(0, 10).join(', ')}.`);
      seeds = seedVertices(meshData, selectMode, ids);
    } else {
      // Vertices are always kept in sync with the edge/face selection, so they seed any mode.
      seeds = new Set(selection.selectedVertexIds);
    }
    if (!seeds.size) fail('nothing to grow from. Select something first or pass ids.');

    const { islands, covered } = islandsFrom(linker, meshData, seeds);
    const linkedIds = elementsInIslands(meshData, selectMode, covered);

    // Total loose parts, so the agent knows whether the mesh splits at all.
    const meshIslands = islandsFrom(linker, meshData, meshData.vertices.keys()).islands.length;

    if (selection.subSelectionMode !== selectMode) {
      editor.execute(new SwitchSubModeCommand(editor, selectMode, selection.subSelectionMode));
    }

    const current = selection[SELECTED_IDS[selectMode]];
    const next = op === 'set' ? new Set(linkedIds) : new Set(current);
    if (op === 'add') linkedIds.forEach((id) => next.add(id));
    if (op === 'subtract') linkedIds.forEach((id) => next.delete(id));

    applySelection(selection, selectMode, [...next]);

    editor.sceneManager.mainScene.updateMatrixWorld(true);
    const worldPos = worldPositionLookup(object, meshData);

    const selectedIds = [...next].sort((a, b) => a - b);

    return {
      uuid: object.uuid,
      name: object.name || 'unnamed',
      selectMode,
      linked: linkedIds.length,
      islands: islands.slice(0, ISLAND_SAMPLE).map((island) => ({
        vertices: island.size,
        bounds: islandBounds(island, worldPos),
      })),
      islandsTruncated: islands.length > ISLAND_SAMPLE,
      meshIslands,
      selected: {
        vertices: selection.selectedVertexIds.size,
        edges: selection.selectedEdgeIds.size,
        faces: selection.selectedFaceIds.size,
      },
      ids: selectedIds.slice(0, ID_SAMPLE),
      idsTruncated: selectedIds.length > ID_SAMPLE,
    };
  },
};