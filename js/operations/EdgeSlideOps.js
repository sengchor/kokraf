import * as THREE from 'three';
import { EdgeSlideCommand } from '../commands/EdgeSlideCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

export const EdgeSlideCommitResult = Object.freeze({
  COMMITTED: 'committed',
  CANCELLED: 'cancelled',
});

export class EdgeSlideOps {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;

    this.session = null;
  }

  get factor() {
    return this.session?.factor ?? null;
  }

  // Session
  beginSession(object, handle) {
    const meshData = object?.userData?.meshData;
    if (!meshData || !handle) return null;

    this.vertexEditor.setObject(object);

    const vertexIds = Array.from(this.editSelection.selectedVertexIds);
    const edgeIds = Array.from(this.editSelection.selectedEdgeIds);

    const regionIds = MeshDataRegion.expand(meshData, { vertexIds, edgeIds, faceIds: [] }, 2);

    this.session = {
      object,
      mode: vertexIds.length === 1 ? 'vertex' : 'edge',
      vertexIds,
      edgeIds,
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      beforeSnapshot: MeshDataRegion.snapshot(meshData, regionIds),
      startElements: {
        startVertexId: meshData.nextVertexId,
        startEdgeId: meshData.nextEdgeId,
        startFaceId: meshData.nextFaceId,
      },
      built: false,
      slide: null,              // { mode, slideData, groupVertexIds }, null if the selection can't slide
      referenceVertexId: null,  // edge mode: vertex whose rails drive the slide
      factor: null,
      side: null,               // edge mode: 'sideA' | 'sideB'; vertex mode: the active side object
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  isBuilt() {
    return !!this.session?.built;
  }

  endSession() {
    this.session = null;
  }

  // Builds the slide rails once per session. Returns the slide or null if the selection can't slide.
  build(handle) {
    const s = this.session;
    if (!s) return null;
    if (s.built) return s.slide;

    s.built = true;
    s.slide = EdgeSlideOps.buildSlideData(this.vertexEditor, s.object, s.mode, s.vertexIds, s.edgeIds);

    handle.position.copy(s.pivotPosition);
    return s.slide;
  }

  setReferenceVertex(vertexId) {
    if (this.session) this.session.referenceVertexId = vertexId;
  }

  // Maps the handle offset to a slide factor and moves the vertices.
  // Returns { vertexData, rail } for the preview line, or null if nothing was applied.
  apply(handle, event, numericActive) {
    const s = this.session;
    if (!s?.slide || !handle) return null;

    const offset = handle.getWorldPosition(new THREE.Vector3()).sub(s.pivotPosition);

    return s.mode === 'vertex'
      ? this.applyVertexSlide(offset)
      : this.applyEdgeSlide(offset, event, numericActive);
  }

  applyVertexSlide(offset) {
    const s = this.session;
    const data = s.slide.slideData.get(s.vertexIds[0]);
    if (!data || !data.sides.length) return null;

    // Pick the side most aligned with the drag
    let bestSide = null;
    let bestScore = -Infinity;

    for (const side of data.sides) {
      const score = offset.dot(side.normalized);
      if (score > bestScore) {
        bestScore = score;
        bestSide = side;
      }
    }

    if (!bestSide) return null;

    s.side = bestSide;
    s.factor = THREE.MathUtils.clamp(bestScore / bestSide.length, -1, 1);
    this.writeVertexSlide();

    return { vertexData: data, rail: bestSide };
  }

  applyEdgeSlide(offset, event, numericActive) {
    const s = this.session;
    const ref = s.slide.slideData.get(s.referenceVertexId);
    if (!ref || (!ref.sideA && !ref.sideB)) return null;

    const scoreA = ref.sideA ? offset.dot(ref.sideA.normalized) : -Infinity;
    const scoreB = ref.sideB ? offset.dot(ref.sideB.normalized) : -Infinity;

    const activeSide = scoreA > scoreB ? 'sideA' : 'sideB';
    const rail = ref[activeSide];

    let factor;
    const snapTarget = this.snapManager.snapEditPosition(event, s.vertexIds, s.object);

    if (snapTarget && !numericActive) {
      factor = snapTarget.clone().sub(ref.origin).dot(rail.normalized) / rail.length;
    } else {
      factor = Math.max(scoreA, scoreB) / rail.length;
    }

    this.setFactor(THREE.MathUtils.clamp(factor, 0, 1), activeSide);

    return { vertexData: ref, rail };
  }

  /**
   * Set the slide factor directly (numeric input, or the drag path above).
   * Edge mode: sign picks the side when side is omitted, magnitude in [0, 1].
   * Vertex mode: signed factor in [-1, 1] along the last used side.
   */
  setFactor(value, side = null) {
    const s = this.session;
    if (!s?.slide) return false;

    if (s.mode === 'vertex') {
      const data = s.slide.slideData.get(s.vertexIds[0]);
      const rail = s.side ?? data?.sides[0];
      if (!rail) return false;

      s.side = rail;
      s.factor = THREE.MathUtils.clamp(value || 0, -1, 1);
      this.writeVertexSlide();
      return true;
    }

    const activeSide = side ?? ((value || 0) >= 0 ? 'sideA' : 'sideB');
    s.side = activeSide;
    s.factor = Math.abs(value || 0);

    const { vertexIds, positions } = EdgeSlideOps.computeEdgeSlidePositions(s.slide, s.factor, activeSide);
    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(vertexIds, positions);
    return true;
  }

  writeVertexSlide() {
    const s = this.session;
    const vertexId = s.vertexIds[0];
    const data = s.slide.slideData.get(vertexId);

    const newPos = s.side.direction.clone().multiplyScalar(s.factor).add(data.origin);

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions([vertexId], [newPos]);
  }

  commit(handle) {
    const s = this.session;
    if (!s) return null;

    if (!s.slide || !s.factor) {
      this.cancel(handle);
      return EdgeSlideCommitResult.CANCELLED;
    }

    const { object } = s;
    this.vertexEditor.setObject(object);

    this.editor.add(EdgeSlideOps.createCommand(this.editor, object, s.beforeSnapshot, s.startElements));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    this.editSelection.clearSelection();
    EdgeSlideOps.selectOriginal(this.editSelection, s);

    this.endSession();
    return EdgeSlideCommitResult.COMMITTED;
  }

  // Restores the mesh, handle and original selection, then ends the session.
  cancel(handle) {
    const s = this.session;
    if (!s) return;

    const meshData = s.object.userData.meshData;
    MeshDataRegion.captureNewElements(meshData, s.startElements, s.beforeSnapshot);

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.applyDelta(s.beforeSnapshot);

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.updateMatrixWorld(true);
    }

    EdgeSlideOps.selectOriginal(this.editSelection, s);
    this.endSession();
  }

  // Non-interactive API (no gizmo, no session).

  static selectOriginal(editSelection, { mode, vertexIds, edgeIds }) {
    if (mode === 'vertex') editSelection.selectVertices(vertexIds);
    else editSelection.selectEdges(edgeIds);
  }

  /**
   * Build the undo command for a slide that is already applied to meshData.
   * Mutates beforeSnapshot (captures new element ids), so call it once.
   */
  static createCommand(editor, object, beforeSnapshot, startElements) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new EdgeSlideCommand(editor, object, beforeSnapshot, afterSnapshot);
  }

  /**
   * Build world-space slide rails for a selection.
   * mode 'vertex': one vertex, one rail per connected edge.
   * mode 'edge': chains of selected edges, two rails (sideA/sideB) per vertex.
   * Returns { mode, slideData, groupVertexIds } or null if the selection can't slide
   * (no edges, a missing vertex, or a vertex joining 3+ selected edges).
   */
  static buildSlideData(vertexEditor, object, mode, vertexIds, edgeIds) {
    const meshData = object.userData.meshData;
    const matrix = object.matrixWorld;

    if (mode === 'vertex') {
      const vertexId = vertexIds[0];
      const data = EdgeSlideOps.buildVertexSlideData(meshData, matrix, vertexId);
      if (!data) return null;

      return { mode, slideData: new Map([[vertexId, data]]), groupVertexIds: [[vertexId]] };
    }

    if (!edgeIds.length) return null;

    const topology = vertexEditor.topology;
    const vertexGraph = topology.buildSelectedVertexGraph(meshData, edgeIds);
    for (const [, info] of vertexGraph) {
      if (info.valence > 2) return null;
    }

    const selectedEdgeSet = new Set(edgeIds.map(id => meshData.edges.get(id)));
    const slideData = new Map();
    const groupVertexIds = [];

    for (const edgeGroup of topology.groupConnectedEdges(meshData, edgeIds)) {
      const edgesInGroup = [...edgeGroup].map(edgeId => meshData.edges.get(edgeId));
      const chain = EdgeSlideOps.orderEdgeChain(edgesInGroup);

      groupVertexIds.push(chain.vertices);
      EdgeSlideOps.buildEdgeSlideData(topology, meshData, matrix, chain, selectedEdgeSet, slideData);
    }

    return { mode, slideData, groupVertexIds };
  }

  static computeEdgeSlidePositions(slide, factor, side) {
    const vertexIds = [];
    const positions = [];

    for (const group of slide.groupVertexIds) {
      for (const vertexId of group) {
        const data = slide.slideData.get(vertexId);
        if (!data) continue; // vertex had no two-face reference edge

        const rail = data[side];
        vertexIds.push(vertexId);
        positions.push(rail
          ? rail.direction.clone().multiplyScalar(factor).add(data.origin)
          : data.origin.clone());
      }
    }

    return { vertexIds, positions };
  }

  static makeRail(direction) {
    return {
      direction,
      length: direction.length(),
      normalized: direction.clone().normalize(),
    };
  }

  static buildVertexSlideData(meshData, matrix, vertexId) {
    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const origin = new THREE.Vector3().copy(vertex.position).applyMatrix4(matrix);
    const data = { origin, sides: [] };

    for (const edgeId of vertex.edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const otherId = edge.v1Id === vertexId ? edge.v2Id : edge.v1Id;
      const other = meshData.getVertex(otherId);
      if (!other) continue;

      const dir = new THREE.Vector3().copy(other.position).applyMatrix4(matrix).sub(origin);
      if (dir.lengthSq() < 1e-8) continue;

      data.sides.push({ edgeId: edge.id, ...EdgeSlideOps.makeRail(dir) });
    }

    return data;
  }

  static buildEdgeSlideData(topology, meshData, matrix, chain, selectedEdgeSet, slideData) {
    const { vertices: orderedVertices, edges: orderedEdges, isClosed } = chain;
    const toWorld = (p) => new THREE.Vector3().copy(p).applyMatrix4(matrix);

    let prevFaceA = null;
    let prevFaceB = null;

    for (let i = 0; i < orderedVertices.length; i++) {
      const vId = orderedVertices[i];
      const vertex = meshData.getVertex(vId);

      const referenceEdge = i === 0 ? orderedEdges[0] : orderedEdges[i - 1];
      if (!referenceEdge) continue;

      const faceIds = Array.from(referenceEdge.faceIds);
      if (faceIds.length < 2) continue;

      // Consistent face orientation along the chain
      let [faceA, faceB] = faceIds;

      if (i > 0) {
        if (faceIds.includes(prevFaceA)) {
          faceA = prevFaceA;
          faceB = faceIds.find(f => f !== faceA);
        } else if (faceIds.includes(prevFaceB)) {
          faceB = prevFaceB;
          faceA = faceIds.find(f => f !== faceB);
        } else {
          faceA = EdgeSlideOps.findAdjacentFace(meshData, faceIds, prevFaceA);
          if (faceA) faceB = faceIds.find(f => f !== faceA);

          if (!faceA) {
            faceB = EdgeSlideOps.findAdjacentFace(meshData, faceIds, prevFaceB);
            if (faceB) faceA = faceIds.find(f => f !== faceB);
          }

          if (!faceA && !faceB) [faceA, faceB] = faceIds;
        }
      }

      prevFaceA = faceA;
      prevFaceB = faceB;

      // Classify unselected connected edges into the two sides
      const candidates = EdgeSlideOps.getCandidateEdges(meshData, vertex, selectedEdgeSet);
      const groupEdges = topology.groupEdgesBySharedFace(candidates);

      let candidatesA = [];
      let candidatesB = [];

      if (groupEdges.length === 1) {
        candidatesA = candidates.filter(edge => edge.faceIds.has(faceA));
        candidatesB = candidates.filter(edge => edge.faceIds.has(faceB));
      } else if (groupEdges.length > 1) {
        const [group1, group2] = groupEdges;
        const groupEdge1 = group1.map(eId => meshData.edges.get(eId));
        const groupEdge2 = group2.map(eId => meshData.edges.get(eId));

        if (groupEdge1.some(edge => edge.faceIds.has(faceA))) {
          candidatesA = groupEdge1;
          candidatesB = groupEdge2;
        } else {
          candidatesA = groupEdge2;
          candidatesB = groupEdge1;
        }
      }

      const vertexWorld = toWorld(vertex.position);

      const prevId = isClosed
        ? orderedVertices[(i - 1 + orderedVertices.length) % orderedVertices.length]
        : orderedVertices[i - 1];
      const nextId = isClosed
        ? orderedVertices[(i + 1) % orderedVertices.length]
        : orderedVertices[i + 1];

      // Fallback rail when a side has no unselected edge
      const bisector = prevId !== undefined && nextId !== undefined
        ? EdgeSlideOps.computeBisector(
            toWorld(meshData.getVertex(prevId).position),
            vertexWorld,
            toWorld(meshData.getVertex(nextId).position)
          )
        : null;

      const data = { origin: vertexWorld };

      const sideA = EdgeSlideOps.resolveSideRail(meshData, vertex, vertexWorld, candidatesA, bisector, toWorld);
      if (sideA) data.sideA = sideA;

      const sideB = EdgeSlideOps.resolveSideRail(meshData, vertex, vertexWorld, candidatesB, bisector, toWorld);
      if (sideB) data.sideB = sideB;

      slideData.set(vId, data);
    }
  }

  static resolveSideRail(meshData, vertex, vertexWorld, candidates, bisector, toWorld) {
    const edge = EdgeSlideOps.pickBestEdge(meshData, vertex, candidates);

    if (edge) {
      const other = meshData.getVertex(edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id);
      const dir = toWorld(other.position).sub(vertexWorld);
      return dir.lengthSq() > 1e-8 ? EdgeSlideOps.makeRail(dir) : null;
    }

    return bisector ? EdgeSlideOps.makeRail(bisector.clone()) : null;
  }

  static getCandidateEdges(meshData, vertex, selectedEdgeSet) {
    return Array.from(vertex.edgeIds)
      .map(id => meshData.edges.get(id))
      .filter(edge => !selectedEdgeSet.has(edge));
  }

  // Currently returns the first non-degenerate candidate (no scoring yet).
  static pickBestEdge(meshData, vertex, candidates) {
    if (!candidates?.length) return null;

    for (const edge of candidates) {
      const otherId = edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id;
      const other = meshData.getVertex(otherId);
      if (!other) continue;

      if (new THREE.Vector3().subVectors(other.position, vertex.position).length() < 1e-8) continue;

      return edge;
    }

    return null;
  }

  static computeBisector(pPrev, p0, pNext) {
    const dir1 = new THREE.Vector3().subVectors(pPrev, p0);
    const dir2 = new THREE.Vector3().subVectors(pNext, p0);

    const bisector = new THREE.Vector3().addVectors(dir1, dir2);
    if (bisector.lengthSq() < 1e-6) return dir1.clone();

    return bisector;
  }

  static findAdjacentFace(meshData, faceIds, targetFaceId) {
    const targetFace = meshData.faces.get(targetFaceId);
    if (!targetFace) return null;

    for (const fId of faceIds) {
      if (fId === targetFaceId) continue;

      const face = meshData.faces.get(fId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        if (targetFace.edgeIds.has(edgeId)) return fId;
      }
    }

    return null;
  }

  static orderEdgeChain(selectedEdges) {
    if (!selectedEdges || selectedEdges.length === 0) {
      return { vertices: [], edges: [], isClosed: false };
    }

    const vertexToEdges = new Map();

    for (const edge of selectedEdges) {
      if (!vertexToEdges.has(edge.v1Id)) vertexToEdges.set(edge.v1Id, []);
      if (!vertexToEdges.has(edge.v2Id)) vertexToEdges.set(edge.v2Id, []);

      vertexToEdges.get(edge.v1Id).push(edge);
      vertexToEdges.get(edge.v2Id).push(edge);
    }

    const endVertices = [];
    for (const [vId, edges] of vertexToEdges) {
      if (edges.length === 1) endVertices.push(vId);
      if (edges.length > 2) console.warn('Invalid chain: branching at vertex', vId);
    }

    const isClosed = endVertices.length === 0;
    const startVertexId = isClosed ? selectedEdges[0].v1Id : endVertices[0];

    // Walk the chain
    const orderedVertexIds = [];
    const orderedEdges = [];
    const visitedEdges = new Set();

    let currentVertex = startVertexId;

    while (true) {
      orderedVertexIds.push(currentVertex);

      const edges = vertexToEdges.get(currentVertex) || [];
      const nextEdge = edges.find(edge => !visitedEdges.has(edge.id));
      if (!nextEdge) break;

      visitedEdges.add(nextEdge.id);
      orderedEdges.push(nextEdge);

      const nextVertex = nextEdge.v1Id === currentVertex ? nextEdge.v2Id : nextEdge.v1Id;
      if (isClosed && nextVertex === startVertexId) break;

      currentVertex = nextVertex;
    }

    return { vertices: orderedVertexIds, edges: orderedEdges, isClosed };
  }
}