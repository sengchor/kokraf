import * as THREE from 'three';

export class VertexBridge {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  bridgeEdgeLoops(vertexIds, edgeIds, faceIds) {
    const groups = this.groupConnectedSelectedEdges(this.meshData, vertexIds, edgeIds, faceIds);

    const loops = [];
    for (const group of groups) {
      const boundaryEdges = this.vertexEditor.selection.getBoundaryEdges([...group.vertices], [...group.edges], [...group.faces]);

      const boundaryEdgeIds = boundaryEdges.map(edge => edge.id);
      const orderedLoops = this.orderLoopVertices(boundaryEdgeIds);

      loops.push(...orderedLoops);
    }

    if (loops.length !== 2) {
      console.warn(`VertexBridge: bridging requires exactly 2 boundary loops, found ${loops.length}`);
      return { success: false, newVertexIds: [], newFaceIds: [] };
    }

    const windedLoops = this.orderLoopsConsistently(loops);
    const alignedLoops = this.alignLoopRotations(windedLoops);

    const newFaceVertexArrays = [];
    for (let pairStart = 0; pairStart + 1 < alignedLoops.length; pairStart += 2) {
      const loopA = alignedLoops[pairStart];
      const loopB = alignedLoops[pairStart + 1];
      newFaceVertexArrays.push(...this.createBridgeFaces(loopA, loopB));
    }

    const newFaceIds = [];
    for (const newFaceVertexIds of newFaceVertexArrays) {
      const newFaceVertex = newFaceVertexIds.map(id => this.meshData.getVertex(id));
      const newFace = this.vertexEditor.addFace(newFaceVertex);
      newFaceIds.push(newFace.id);
    }

    return {
      success: true,
      newVertexIds: [...new Set(newFaceVertexArrays.flat())],
      newFaceIds: newFaceIds,
    };
  }

  groupConnectedSelectedEdges(meshData, vertexIds, edgeIds, faceIds) {
    const parent = new Map();

    const find = (id) => {
      if (!parent.has(id)) parent.set(id, id);
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      let cur = id;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur);
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };

    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const vId of vertexIds) find(vId);

    const edgeVerts = new Map();
    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      edgeVerts.set(edgeId, [edge.v1Id, edge.v2Id]);
      find(edge.v1Id);
      find(edge.v2Id);
      union(edge.v1Id, edge.v2Id);
    }

    const faceVerts = new Map();
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      const verts = face.vertexIds;
      faceVerts.set(faceId, verts);
      for (const vId of verts) find(vId);
      for (let i = 0; i < verts.length; i++) {
        union(verts[i], verts[(i + 1) % verts.length]);
      }
    }

    const groups = new Map();
    const getGroup = (root) => {
      if (!groups.has(root)) {
        groups.set(root, { vertices: new Set(), edges: new Set(), faces: new Set() });
      }
      return groups.get(root);
    };

    for (const vId of vertexIds) {
      getGroup(find(vId)).vertices.add(vId);
    }
    for (const [edgeId, [v1]] of edgeVerts) {
      getGroup(find(v1)).edges.add(edgeId);
    }
    for (const [faceId, verts] of faceVerts) {
      getGroup(find(verts[0])).faces.add(faceId);
    }

    return [...groups.values()];
  }

  orderLoopVertices(boundaryEdgeIds) {
    const meshData = this.meshData;

    const adjacency = new Map();
    const link = (a, b, edgeId) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ vertexId: b, edgeId });
    };

    const uniqueEdgeIds = [...new Set(boundaryEdgeIds)];
    for (const edgeId of uniqueEdgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      link(edge.v1Id, edge.v2Id, edgeId);
      link(edge.v2Id, edge.v1Id, edgeId);
    }

    const visitedEdges = new Set();
    const loops = [];

    const walkFrom = (firstVertex, firstEdgeId) => {
      const vertices = [firstVertex];
      visitedEdges.add(firstEdgeId);

      let currentVertex = adjacency.get(firstVertex)
        .find(n => n.edgeId === firstEdgeId).vertexId;

      while (true) {
        vertices.push(currentVertex);

        if (currentVertex === firstVertex) {
          return { vertices: vertices.slice(0, -1), closed: true };
        }

        const neighbors = adjacency.get(currentVertex) || [];
        const next = neighbors.find(n => !visitedEdges.has(n.edgeId));
        if (!next) {
          return { vertices, closed: false };
        }

        visitedEdges.add(next.edgeId);
        currentVertex = next.vertexId;
      }
    };

    for (const [vId, neighbors] of adjacency) {
      if (neighbors.length !== 1) continue;
      const { edgeId } = neighbors[0];
      if (visitedEdges.has(edgeId)) continue;
      loops.push(walkFrom(vId, edgeId));
    }

    for (const [vId, neighbors] of adjacency) {
      for (const { edgeId } of neighbors) {
        if (visitedEdges.has(edgeId)) continue;
        loops.push(walkFrom(vId, edgeId));
        break;
      }
    }

    return loops;
  }

  orderLoopsConsistently(loops, referenceNormal = null) {
    const meshData = this.meshData;
    const getPos = (id) => meshData.vertices.get(id).position;

    const computeLoopNormal = (vertexIds) => {
      const normal = new THREE.Vector3();
      const n = vertexIds.length;
      if (n < 3) return null;

      for (let i = 0; i < n; i++) {
        const curr = getPos(vertexIds[i]);
        const next = getPos(vertexIds[(i + 1) % n]);
        normal.x += (curr.y - next.y) * (curr.z + next.z);
        normal.y += (curr.z - next.z) * (curr.x + next.x);
        normal.z += (curr.x - next.x) * (curr.y + next.y);
      }

      return normal.lengthSq() > 1e-12 ? normal.normalize() : null;
    };

    const normals = loops.map(loop => computeLoopNormal(loop.vertices));

    const ref = referenceNormal ? referenceNormal.clone().normalize()
      : normals.find(n => n !== null);

    if (!ref) return loops;

    return loops.map((loop, i) => {
      const normal = normals[i];
      if (normal && normal.dot(ref) < 0) {
        return { vertices: [...loop.vertices].reverse(), closed: loop.closed };
      }
      return loop;
    });
  }

  alignLoopRotations(loops) {
    const aligned = loops.map(loop => ({ ...loop, vertices: [...loop.vertices] }));

    for (let pairStart = 0; pairStart + 1 < aligned.length; pairStart += 2) {
      const loopA = aligned[pairStart];
      const loopB = aligned[pairStart + 1];

      if (loopA.closed && loopB.closed) {
        const shift = this.findBestClosedShift(loopA.vertices, loopB.vertices);
        loopB.vertices = this.rotateArray(loopB.vertices, shift);
      } else {
        loopB.vertices = this.findBestOpenOrientation(loopA.vertices, loopB.vertices);
      }

      return aligned;
    }
  }

  findBestClosedShift(vertsA, vertsB) {
    const meshData = this.meshData;
    const getPos = (id) => new THREE.Vector3().copy(meshData.vertices.get(id).position);

    const n = Math.max(vertsA.length, vertsB.length);
    const mapA = this.resampleClosed(vertsA.length, n);
    const sampledA = mapA.map(idx => getPos(vertsA[idx]));

    let bestShift = 0;
    let bestCost = Infinity;

    for (let shift = 0; shift < vertsB.length; shift++) {
      const rotatedB = this.rotateArray(vertsB, shift);
      const mapB = this.resampleClosed(rotatedB.length, n);

      let cost = 0;
      for (let k = 0; k < n; k++) {
        cost += sampledA[k].distanceToSquared(getPos(rotatedB[mapB[k]]));
      }

      if (cost < bestCost) {
        bestCost = cost;
        bestShift = shift;
      }
    }

    return bestShift;
  }

  findBestOpenOrientation(vertsA, vertsB) {
    const meshData = this.meshData;
    const getPos = (id) => new THREE.Vector3().copy(meshData.vertices.get(id).position);

    const n = Math.max(vertsA.length, vertsB.legnth);
    const mapA = this.resampleOpen(vertsA.length, n);
    const sampledA = mapA.map(idx => getPos(vertsA[idx]));

    const costOf = (verts) => {
      const map = this.resampleOpen(verts.length, n);
      let cost = 0;
      for (let k = 0; k < n; k++) {
        cost += sampledA[k].distanceToSquared(getPos(verts[map[k]]));
      }
      return cost;
    };

    const reversed = [...vertsB].reverse();
    return costOf(reversed) < costOf(vertsB) ? reversed : vertsB;
  }

  rotateArray(arr, startIndex) {
    if (startIndex === 0) return arr;
    return [...arr.slice(startIndex), ...arr.slice(0, startIndex)];
  }

  createBridgeFaces(loopA, loopB) {
    if (loopA.closed !== loopB.closed) {
      console.warn('VertexBridge: cannot bridge a closed loop to an open chain');
      return [];
    }

    return loopA.closed
      ? this.bridgeClosedLoopPair(loopA.vertices, loopB.vertices)
      : this.bridgeOpenLoopPair(loopA.vertices, loopB.vertices);
  }

  resampleClosed(sourceCount, targetCount) {
    const map = new Array(targetCount);
    for (let i = 0; i < targetCount; i++) {
      map[i] = Math.floor((i * sourceCount) / targetCount) % sourceCount;
    }
    return map;
  }

  resampleOpen(sourceCount, targetCount) {
    const map = new Array(targetCount);
    if (targetCount === 1) return [0];
    for (let i = 0; i < targetCount; i++) {
      map[i] = Math.round((i * (sourceCount - 1)) / (targetCount - 1));
    }
    return map;
  }

  emitBridgeSegment(a0, a1, b0, b1, faces) {
    if (a0 === a1 && b0 === b1) return;
    if (a0 === a1) {
      faces.push([a0, b1, b0]);
    } else if (b0 === b1) {
      faces.push([a0, a1, b0]);
    } else {
      faces.push([a0, a1, b1, b0]);
    }
  }

  bridgeClosedLoopPair(a, b) {
    const n = Math.max(a.length, b.length);
    const mapA = this.resampleClosed(a.length, n);
    const mapB = this.resampleClosed(b.length, n);

    const faces = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      this.emitBridgeSegment(a[mapA[i]], a[mapA[next]], b[mapB[i]], b[mapB[next]], faces);
    }
    return faces;
  }

  bridgeOpenLoopPair(a, b) {
    const n = Math.max(a.length, b.length);
    const mapA = this.resampleOpen(a.length, n);
    const mapB = this.resampleOpen(b.length, n);

    const faces = [];
    for (let i = 0; i < n - 1; i++) {
      this.emitBridgeSegment(a[mapA[i]], a[mapA[i + 1]], b[mapB[i]], b[mapB[i + 1]], faces);
    }
    return faces;
  }
}