import * as THREE from 'three';

export class VertexBridge {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  bridgeEdgeLoops(vertexIds, edgeIds, faceIds, options = {}) {
    const { numCuts = 0, smoothness = 0 } = options;

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

      const result = this.createBridgeFaces(loopA, loopB, numCuts, smoothness);

      if (!result.success) {
        return { success: false, newVertexIds: [], newFaceIds: [] };
      }
      newFaceVertexArrays.push(...result.faces);
    }

    const newFaceIds = [];
    for (const newFaceVertexIds of newFaceVertexArrays) {
      const newFaceVertex = newFaceVertexIds.map(id => this.meshData.getVertex(id));
      const newFace = this.vertexEditor.addFace(newFaceVertex);
      newFaceIds.push(newFace.id);
    }

    for (const faceId of faceIds) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;
      this.vertexEditor.deleteFace(face);
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

  computeLoopNormal(vertexIds) {
    const meshData = this.meshData;
    const getPos = (id) => meshData.vertices.get(id).position;
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
  }

  orderLoopsConsistently(loops, referenceNormal = null) {
    const normals = loops.map(loop => this.computeLoopNormal(loop.vertices));

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

    const n = Math.max(vertsA.length, vertsB.length);
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

  createBridgeFaces(loopA, loopB, numCuts = 0, smoothness = 0) {
    if (loopA.closed !== loopB.closed) {
      console.warn('VertexBridge: cannot bridge a closed loop to an open chain');
      return { success: false, faces: [], };
    }

    let faces;
    if (numCuts <= 0) {
      faces = loopA.closed
        ? this.bridgeClosedLoopPair(loopA.vertices, loopB.vertices)
        : this.bridgeOpenLoopPair(loopA.vertices, loopB.vertices);
    } else {
      faces = this.bridgeLoft(loopA, loopB, numCuts, smoothness);
    }

    return { success: true, faces, };
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

  bridgeLoft(loopA, loopB, numCuts, smoothness) {
    const meshData = this.meshData;
    const closed = loopA.closed;
    const resample = closed ? this.resampleClosed.bind(this) : this.resampleOpen.bind(this);

    const n = Math.max(loopA.vertices.length, loopB.vertices.length);
    const mapA = resample(loopA.vertices.length, n);
    const mapB = resample(loopB.vertices.length, n);

    const posA = mapA.map(i => meshData.getVertex(loopA.vertices[i]).position.clone());
    const posB = mapB.map(i => meshData.getVertex(loopB.vertices[i]).position.clone());

    const normalA = this.computeLoopNormal(loopA.vertices) || new THREE.Vector3(0, 1, 0);
    const normalB = this.computeLoopNormal(loopB.vertices) || new THREE.Vector3(0, -1, 0);

    const centerA = posA.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(n);
    const centerB = posB.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(n);

    const centerDir = centerB.clone().sub(centerA).normalize();
    
    const dirA = normalA.clone().normalize();
    if (dirA.dot(centerDir) < 0) dirA.negate();

    const dirB = normalB.clone().normalize();
    if (dirB.dot(centerDir) < 0) dirB.negate();

    const span = centerA.distanceTo(centerB);
    const tangentA = dirA.clone().multiplyScalar(span);
    const tangentB = dirB.clone().multiplyScalar(span);

    const hermite = (p0, p1, m0, m1, t) => {
      const t2 = t * t, t3 = t2 * t;
      return new THREE.Vector3()
        .addScaledVector(p0, 2 * t3 - 3 * t2 + 1)
        .addScaledVector(m0, t3 - 2 * t2 + t)
        .addScaledVector(p1, -2 * t3 + 3 * t2)
        .addScaledVector(m1, t3 - t2);
    };

    const hermiteDerivative = (p0, p1, m0, m1, t) => {
      const t2 = t * t;
      return new THREE.Vector3()
        .addScaledVector(p0, 6 * t2 - 6 * t)
        .addScaledVector(m0, 3 * t2 - 4 * t + 1)
        .addScaledVector(p1, -6 * t2 + 6 * t)
        .addScaledVector(m1, 3 * t2 - 2 * t);
    };

    const up = new THREE.Vector3(0, 0, 1);
    const quatA = new THREE.Quaternion().setFromUnitVectors(up, dirA);
    let quatB = new THREE.Quaternion().setFromUnitVectors(up, dirB);
    
    const invQuatA = quatA.clone().invert();
    let invQuatB = quatB.clone().invert();

    // PHASE ALIGNMENT
    const localA0 = posA[0].clone().sub(centerA).applyQuaternion(invQuatA);
    const localB0 = posB[0].clone().sub(centerB).applyQuaternion(invQuatB);
    
    const angleA = Math.atan2(localA0.y, localA0.x);
    const angleB = Math.atan2(localB0.y, localB0.x);
    let angleDiff = angleA - angleB;

    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const twistQuat = new THREE.Quaternion().setFromAxisAngle(up, angleDiff);
    invQuatB.premultiply(twistQuat); 
    quatB.multiply(twistQuat.clone().invert()); 

    const rings = [mapA.map(i => loopA.vertices[i])];

    for (let cut = 1; cut <= numCuts; cut++) {
      const t = cut / (numCuts + 1);

      const linearCenter = centerA.clone().lerp(centerB, t);
      const curvedCenter = hermite(centerA, centerB, tangentA, tangentB, t);
      const currentCenter = linearCenter.lerp(curvedCenter, smoothness);

      const curvedDir = hermiteDerivative(centerA, centerB, tangentA, tangentB, t).normalize();
      const currentDir = centerDir.clone().lerp(curvedDir, smoothness).normalize();

      // ROLL-PRESERVING TANGENT ALIGNMENT
      const blendedBaseQuat = quatA.clone().slerp(quatB, t);
      const blendedDir = up.clone().applyQuaternion(blendedBaseQuat);
      const alignQuat = new THREE.Quaternion().setFromUnitVectors(blendedDir, currentDir);
      
      const partialAlignQuat = new THREE.Quaternion().identity().slerp(alignQuat, smoothness);
      const finalQuat = partialAlignQuat.multiply(blendedBaseQuat);

      const ring = [];
      for (let k = 0; k < n; k++) {
        const localA = posA[k].clone().sub(centerA).applyQuaternion(invQuatA);
        const localB = posB[k].clone().sub(centerB).applyQuaternion(invQuatB);

        const localBlended = localA.lerp(localB, t);
        localBlended.applyQuaternion(finalQuat).add(currentCenter);

        ring.push(this.vertexEditor.addVertex(localBlended).id);
      }
      rings.push(ring);
    }
    rings.push(mapB.map(i => loopB.vertices[i]));

    const faces = [];
    const segments = closed ? n : n - 1;
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let i = 0; i < segments; i++) {
        const next = closed ? (i + 1) % n : i + 1;
        this.emitBridgeSegment(rings[r][i], rings[r][next], rings[r + 1][i], rings[r + 1][next], faces);
      }
    }

    return faces;
  }
}