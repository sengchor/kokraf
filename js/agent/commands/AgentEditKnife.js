import * as THREE from 'three';
import { KnifeOps } from '../../operations/KnifeOps.js';
import { GPUEdgePicker } from '../../utils/GPUEdgePicker.js';
import { worldToScreen } from '../../utils/ScreenUtils.js';
import { resolveTargets } from '../AgentUtils.js';
import { AXES_NOTE, positionToThree } from '../AgentAxes.js';

const EDGE_HELPER_NAME = '__EdgeLinesVisual';

// One picker per editor, separate from the interactive KnifeTool's picker so the agent never disturbs its state.
const agentPickers = new WeakMap();

export const editKnifeSpec = {
  description:
    AXES_NOTE +
    'Knife-cut a single mesh object along a straight line from a to b (edit-mode knife). ' +
    'The cut surface is the plane through a and b that contains `direction`, as if the line were drawn in a viewport ' +
    'looking along `direction` (its sign matters only for which side counts as visible). ' +
    'By default only edges visible when looking along `direction` are cut, like the interactive knife; ' +
    'set throughAll to also cut hidden geometry (front and back). ' +
    'a / b are either a vertex id (the cut snaps to that vertex) or a world-space [x, y, z] that need not lie on the surface. ' +
    'Rejected without changes if the cut crosses nothing, only retraces existing edges, or would cross one face more than twice ' +
    '(split it into smaller cuts instead). Undoable as one step; the cut is selected afterwards. Use mesh.inspect to find ids.',
  mutates: true,
  params: {
    target: { type: 'string', description: 'uuid or name of a mesh object.' },
    a: { type: 'number|vec3', description: 'Start of the cut: vertex id to snap to, or world-space [x, y, z].' },
    b: { type: 'number|vec3', description: 'End of the cut: vertex id to snap to, or world-space [x, y, z].' },
    direction: {
      type: 'vec3',
      description: 'World-space view direction (from the eye into the scene). Must not be parallel to a -> b.',
    },
    throughAll: {
      type: 'boolean',
      description: 'Optional, default false. true cuts hidden edges too; false cuts only edges visible along direction.',
    },
  },

  // Validates inputs only. Picking needs the object's edit-mode edge helper, so the plan is computed in run().
  prepare({ target, a, b, direction, throughAll = false }, editor) {
    const objects = resolveTargets(editor, target);
    if (objects.length !== 1) throw new Error('edit.knife: target must resolve to exactly one object.');
    const object = objects[0];

    if (!editor.modeManager.isValidMesh(object)) {
      throw new Error(`edit.knife: "${object.name || object.uuid}" is not an editable mesh.`);
    }

    const meshData = object.userData.meshData;
    editor.sceneManager.mainScene.updateMatrixWorld(true);
    const matrixWorld = object.matrixWorld;

    const aCut = resolveEndpoint(meshData, matrixWorld, a, 'a');
    const bCut = resolveEndpoint(meshData, matrixWorld, b, 'b');

    const segment = new THREE.Vector3().subVectors(bCut.position, aCut.position);
    if (segment.lengthSq() < 1e-12) throw new Error('edit.knife: a and b coincide.');

    const viewDir = new THREE.Vector3().copy(positionToThree(direction));
    if (viewDir.lengthSq() < 1e-12) throw new Error('edit.knife: direction must be non-zero.');
    viewDir.normalize();

    if (segment.clone().normalize().cross(viewDir).lengthSq() < 1e-6) {
      throw new Error('edit.knife: direction is parallel to the a -> b line, so it does not define a cut plane.');
    }

    return { modeTarget: object, object, aCut, bCut, viewDir, throughAll: Boolean(throughAll) };
  },

  run(_params, editor, { object, aCut, bCut, viewDir, throughAll }) {
    const meshData = object.userData.meshData;
    editor.sceneManager.mainScene.updateMatrixWorld(true);
    const matrixWorld = object.matrixWorld;

    const camera = createViewCamera(editor, object, aCut.position, bCut.position, viewDir);

    const candidateEdgeIds = throughAll
      ? meshData.edges.keys()
      : pickVisibleEdgeIds(editor, object, camera, aCut.position, bCut.position);

    const plan = KnifeOps.computeCutPlan(meshData, matrixWorld, camera, aCut, bCut, candidateEdgeIds);
    validatePlan(meshData, matrixWorld, plan, throughAll);

    const result = new KnifeOps(editor).cut(object, plan);
    if (!result) throw new Error('edit.knife: nothing was cut.');

    editor.signals.objectChanged.dispatch();

    return {
      uuid: object.uuid,
      name: object.name || '(unnamed)',
      throughAll,
      crossedEdgeCount: plan.points.filter(p => p.edge).length,
      cutVertexIds: result.newVertexIds,
      newEdgeIds: result.newEdgeIds,
      faceCount: meshData.faces.size,
    };
  },
};

function resolveEndpoint(meshData, matrixWorld, value, label) {
  if (typeof value === 'number') {
    const vertex = meshData.getVertex(value);
    if (!vertex) throw new Error(`edit.knife: ${label} vertex ${value} does not exist.`);

    const position = new THREE.Vector3().copy(vertex.position).applyMatrix4(matrixWorld);
    return { position, snapVertexId: vertex.id };
  }

  if (Array.isArray(value) && value.length === 3) {
    return { position: new THREE.Vector3().copy(positionToThree(value)), snapVertexId: null };
  }

  throw new Error(`edit.knife: ${label} must be a vertex id or a world-space [x, y, z].`);
}

// Orthographic camera looking along viewDir that frames the whole mesh and both endpoints,
// with the viewport's aspect so worldToScreen and the picker's render target line up.
function createViewCamera(editor, object, aPos, bPos, viewDir) {
  const size = editor.renderer.renderer.getSize(new THREE.Vector2());
  const aspect = size.x > 0 && size.y > 0 ? size.x / size.y : 1;

  object.geometry.computeBoundingBox();
  const sphere = new THREE.Box3()
    .setFromObject(object)
    .expandByPoint(aPos)
    .expandByPoint(bPos)
    .getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 1e-3) * 1.05;

  const halfW = aspect >= 1 ? r * aspect : r;
  const halfH = aspect >= 1 ? r : r / aspect;

  // Camera 2r back from the centre: the framed sphere spans depth r..3r, well inside near/far.
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, r * 0.5, r * 3.5);
  camera.up.set(0, 1, 0);
  if (Math.abs(viewDir.dot(camera.up)) > 0.99) camera.up.set(0, 0, 1);

  camera.position.copy(sphere.center).addScaledVector(viewDir, -2 * r);
  camera.lookAt(sphere.center);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}

// Edge ids the GPU picker sees along the a -> b screen segment (depth-tested, so hidden edges are excluded).
function pickVisibleEdgeIds(editor, object, camera, aPos, bPos) {
  if (editor.editSelection.editedObject !== object) {
    throw new Error('edit.knife: the object is not in edit mode, so its visible edges cannot be picked.');
  }

  const edgeHelper = editor.sceneManager.sceneHelpers.getObjectByName(EDGE_HELPER_NAME);
  if (!edgeHelper) {
    throw new Error('edit.knife: edit-mode edge helper not found, so visible edges cannot be picked.');
  }

  const renderer = editor.renderer.renderer;
  const size = renderer.getSize(new THREE.Vector2());
  if (!size.x || !size.y) {
    throw new Error('edit.knife: the viewport has no size, so visible edges cannot be picked. Try throughAll.');
  }

  let picker = agentPickers.get(editor);
  if (!picker) {
    picker = new GPUEdgePicker(editor);
    agentPickers.set(editor, picker);
  }

  picker.resize(size.x, size.y);
  picker.buildFromHelper(edgeHelper);
  picker.buildFromObject(object);
  picker.dirty = true;

  try {
    const aScreen = worldToScreen(aPos, camera, renderer);
    const bScreen = worldToScreen(bPos, camera, renderer);
    // Copy out before dispose, in case the picker returns a view of its internal buffers.
    return [...(picker.pickSegment(aScreen.x, aScreen.y, bScreen.x, bScreen.y, camera) ?? [])];
  } finally {
    picker.dispose();
  }
}

function validatePlan(meshData, matrixWorld, plan, throughAll) {
  if (!plan.points.length) {
    throw new Error(
      throughAll
        ? 'edit.knife: the cut crosses no edges. Check a, b and direction.'
        : 'edit.knife: the cut crosses no visible edges. Check a, b and direction, or set throughAll to cut hidden edges.'
    );
  }

  if (KnifeOps.matchesExistingPolyline(meshData, matrixWorld, plan)) {
    throw new Error('edit.knife: the cut only retraces existing edges; nothing to cut.');
  }

  const { cutFaceCount, overcutFaceIds } = analyzeFaceCuts(meshData, plan);
  if (!cutFaceCount) {
    throw new Error('edit.knife: the cut does not split or modify any face.');
  }
  if (overcutFaceIds.length) {
    throw new Error(
      `edit.knife: the cut crosses face(s) ${overcutFaceIds.join(', ')} more than twice, which the knife cannot split. ` +
        'Use a shorter cut or cut in several steps.'
    );
  }
}

function analyzeFaceCuts(meshData, plan) {
  const { points } = plan;
  const cutEdgeIds = new Set(points.filter(p => p.edge).map(p => p.edge.id));
  const snapIds = new Set([plan.a.snapVertexId, plan.b.snapVertexId].filter(id => id !== null && id !== undefined));

  const affectedFaces = new Set();
  points.forEach((point, i) => {
    if (point.edge) {
      for (const faceId of point.edge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (face) affectedFaces.add(face);
      }
    } else {
      KnifeOps.collectSnapAffectedFaces(meshData, points, i, affectedFaces);
    }
  });

  let cutFaceCount = 0;
  const overcutFaceIds = [];

  for (const face of affectedFaces) {
    const ids = face.vertexIds;
    let cuts = 0;

    for (let i = 0; i < ids.length; i++) {
      const edge = meshData.getEdge(ids[i], ids[(i + 1) % ids.length]);
      if (edge && cutEdgeIds.has(edge.id)) cuts++;
      if (snapIds.has(ids[i])) cuts++;
    }

    if (cuts > 0) cutFaceCount++;
    if (cuts > 2) overcutFaceIds.push(face.id);
  }

  return { cutFaceCount, overcutFaceIds };
}