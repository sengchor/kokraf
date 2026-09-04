export class UVSelection {
  constructor(context) {
    this.context = context;

    this.mode = 'vertex';
    this.vertices = new Set();
    this.edges = new Set();
    this.faces = new Set();
    this.version = 0;
  }

  getMeshData() {
    return this.context.getMeshData();
  }

  uvToScreen(u, v) {
    return this.context.uvToScreen(u, v);
  }

  setMode(mode) {
    if (!['vertex', 'edge', 'face'].includes(mode) || mode === this.mode) return false;
    this.mode = mode;
    this.resolveFromMode();
    return true;
  }

  resolveFromMode(topo = this.buildTopology()) {
    if (this.mode === 'vertex') {
      const { edgeSet, faceSet } = this.resolveSelectionGraphFromVertices(this.vertices, topo);
      this.edges = edgeSet;
      this.faces = faceSet;
    } else if (this.mode === 'edge') {
      const { vertexSet, faceSet } = this.resolveSelectionGraphFromEdges(this.edges, topo);
      this.vertices = vertexSet;
      this.faces = faceSet;
    } else if (this.mode === 'face') {
      const { vertexSet, edgeSet } = this.resolveSelectionGraphFromFaces(this.faces, topo);
      this.vertices = vertexSet;
      this.edges = edgeSet;
    }
    this.version++;
  }

  clear() {
    this.vertices.clear();
    this.edges.clear();
    this.faces.clear();
    this.version++;
  }

  getActiveSet() {
    if (this.mode === 'edge') return this.edges;
    if (this.mode === 'face') return this.faces;
    return this.vertices;
  }

  isSelected(type, key) {
    if (type === 'edge') return this.edges.has(key);
    if (type === 'face') return this.faces.has(key);
    return this.vertices.has(key);
  }

  // UV topology
  resolveSelectionGraphFromVertices(vertexSet, topo = this.buildTopology()) {
    const edgeSet = new Set();
    const faceSet = new Set();

    for (const edge of topo.edges) {
      if (vertexSet.has(edge.aKey) && vertexSet.has(edge.bKey)) {
        edgeSet.add(edge.key);
      }
    }

    for (const [faceId, cornerKeys] of topo.faceCornerKeys) {
      if (cornerKeys.every(k => vertexSet.has(k))) {
        faceSet.add(faceId);
      }
    }

    return { edgeSet, faceSet };
  }

  resolveSelectionGraphFromEdges(edgeSet, topo = this.buildTopology()) {
    const vertexSet = new Set();
    const faceSet = new Set();

    for (const edgeKey of edgeSet) {
      const edge = topo.edgesByKey.get(edgeKey);
      if (!edge) continue;
      vertexSet.add(edge.aKey);
      vertexSet.add(edge.bKey);
    }

    for (const [faceId, edgeKeys] of topo.faceEdgeKeys) {
      if (edgeKeys.every(k => edgeSet.has(k))) {
        faceSet.add(faceId);
      }
    }

    return { vertexSet, faceSet };
  }

  resolveSelectionGraphFromFaces(faceSet, topo = this.buildTopology()) {
    const vertexSet = new Set();
    const edgeSet = new Set();

    for (const faceId of faceSet) {
      const cornerKeys = topo.faceCornerKeys.get(faceId);
      const edgeKeys = topo.faceEdgeKeys.get(faceId);
      if (!cornerKeys || !edgeKeys) continue;

      for (const key of cornerKeys) vertexSet.add(key);
      for (const key of edgeKeys) edgeSet.add(key);
    }

    return { vertexSet, edgeSet };
  }

  isFaceUVComplete(face, faceUVs) {
    if (!faceUVs || faceUVs.length !== face.vertexIds.length) return false;
    for (const uv of faceUVs) {
      if (!uv || !Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return false;
    }
    return true;
  }

  buildTopology(epsilon = 1e-5) {
    const meshData = this.getMeshData();

    if (this._topo && this._topoSource === meshData) {
      return this._topo;
    }

    this._topo = this._computeTopology(meshData, epsilon);
    this._topoSource = meshData;
    return this._topo;
  }

  invalidateTopology() {
    this._topo = null;
    this._topoSource = null;
  }

  _computeTopology(meshData, epsilon = 1e-5) {
    const empty = {
      points: [],
      pointsByKey: new Map(),
      cornerToPointKey: new Map(),
      edges: [],
      edgesByKey: new Map(),
      faceCornerKeys: new Map(),
      faceEdgeKeys: new Map()
    };
    if (!meshData) return empty;
 
    const byVertex = new Map();
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this.isFaceUVComplete(face, faceUVs)) continue;
 
      for (let i = 0; i < faceUVs.length; i++) {
        const vertexId = face.vertexIds[i];
        if (!byVertex.has(vertexId)) byVertex.set(vertexId, []);
        byVertex.get(vertexId).push({ faceId: face.id, corner: i, u: faceUVs[i].u, v: faceUVs[i].v });
      }
    }
 
    const points = [];
    const cornerToPointKey = new Map();
 
    for (const [vertexId, corners] of byVertex) {
      const clusters = [];
 
      for (const c of corners) {
        let cluster = clusters.find(
          cl => Math.abs(cl.u - c.u) <= epsilon && Math.abs(cl.v - c.v) <= epsilon
        );
        if (!cluster) {
          cluster = { u: c.u, v: c.v, corners: [] };
          clusters.push(cluster);
        }
        cluster.corners.push(c);
      }
 
      for (const cluster of clusters) {
        const key = `${vertexId}_${cluster.u.toFixed(5)}_${cluster.v.toFixed(5)}`;
        points.push({ key, vertexId, u: cluster.u, v: cluster.v, corners: cluster.corners });
        for (const c of cluster.corners) {
          cornerToPointKey.set(`${c.faceId}_${c.corner}`, key);
        }
      }
    }
 
    const pointsByKey = new Map(points.map(p => [p.key, p]));
 
    const edgesByKey = new Map();
    const faceCornerKeys = new Map();
    const faceEdgeKeys = new Map();
 
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this.isFaceUVComplete(face, faceUVs)) continue;
 
      const n = face.vertexIds.length;
      const cornerKeys = [];
      const edgeKeys = [];
      let complete = true;
 
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const keyA = cornerToPointKey.get(`${face.id}_${i}`);
        const keyB = cornerToPointKey.get(`${face.id}_${j}`);
        if (!keyA || !keyB) {
          complete = false;
          continue;
        }
 
        const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
        let edge = edgesByKey.get(edgeKey);
        if (!edge) {
          edge = { key: edgeKey, aKey: keyA, bKey: keyB, faceIds: new Set() };
          edgesByKey.set(edgeKey, edge);
        }
        edge.faceIds.add(face.id);
 
        cornerKeys.push(keyA);
        edgeKeys.push(edgeKey);
      }
 
      if (complete && cornerKeys.length === n) {
        faceCornerKeys.set(face.id, cornerKeys);
        faceEdgeKeys.set(face.id, edgeKeys);
      }
    }
 
    return {
      points,
      pointsByKey,
      cornerToPointKey,
      edges: Array.from(edgesByKey.values()),
      edgesByKey,
      faceCornerKeys,
      faceEdgeKeys
    };
  }

  getHighlight() {
    return { points: this.vertices, edges: this.edges, faces: this.faces };
  }

  // Hit testing
  hitTestPoint(x, y, points, radius = 8) {
    for (const point of points) {
      const p = this.uvToScreen(point.u, point.v);
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy <= radius * radius) return point.key;
    }
    return null;
  }
 
  hitTestEdge(x, y, edges, pointsByKey, radius = 6) {
    let closestKey = null;
    let closestDist = radius;
 
    for (const edge of edges) {
      const a = pointsByKey.get(edge.aKey);
      const b = pointsByKey.get(edge.bKey);
      if (!a || !b) continue;
 
      const pa = this.uvToScreen(a.u, a.v);
      const pb = this.uvToScreen(b.u, b.v);
      const dist = this._distanceToSegment(x, y, pa.x, pa.y, pb.x, pb.y);
 
      if (dist <= closestDist) {
        closestDist = dist;
        closestKey = edge.key;
      }
    }
    return closestKey;
  }
 
  hitTestFace(x, y) {
    const meshData = this.getMeshData();
    if (!meshData) return null;
 
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this.isFaceUVComplete(face, faceUVs)) continue;
 
      const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
      if (this._pointInPolygon(x, y, screenPoints)) return face.id;
    }
    return null;
  }
 
  hitTestActive(x, y, topo = this.buildTopology()) {
    if (this.mode === 'edge') return this.hitTestEdge(x, y, topo.edges, topo.pointsByKey);
    if (this.mode === 'face') return this.hitTestFace(x, y);
    return this.hitTestPoint(x, y, topo.points);
  }
 
  _distanceToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    let t = abLenSq > 0 ? (apx * abx + apy * aby) / abLenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx, cy = ay + t * aby;
    const dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }
 
  _pointInPolygon(x, y, screenPoints) {
    let inside = false;
    for (let i = 0, j = screenPoints.length - 1; i < screenPoints.length; j = i++) {
      const xi = screenPoints[i].x, yi = screenPoints[i].y;
      const xj = screenPoints[j].x, yj = screenPoints[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Selection operations
  selectAt(x, y, additive = false) {
    const topo = this.buildTopology();
    const hitKey = this.hitTestActive(x, y);
    const set = this.getActiveSet();
 
    if (hitKey !== null) {
      if (additive && set.has(hitKey)) {
        set.delete(hitKey);
      } else if (additive) {
        set.add(hitKey);
      }

      if (!additive) {
        set.clear();
        set.add(hitKey);
      }
    }

    if (!additive && hitKey === null) {
      set.clear();
    }
 
    this.resolveFromMode(topo);
    return hitKey;
  }
 
  boxSelect(minX, minY, maxX, maxY, additive = false) {
    const meshData = this.getMeshData();
    if (!meshData) return;

    if (!additive) {
      this.getActiveSet().clear();
    }

    const topo = this.buildTopology();
    const inBox = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
 
    if (this.mode === 'vertex') {
      for (const point of topo.points) {
        if (inBox(this.uvToScreen(point.u, point.v))) this.vertices.add(point.key);
      }
    }
 
    if (this.mode === 'edge') {
      for (const edge of topo.edges) {
        const a = topo.pointsByKey.get(edge.aKey);
        const b = topo.pointsByKey.get(edge.bKey);
        if (!a || !b) continue;
        const pa = this.uvToScreen(a.u, a.v);
        const pb = this.uvToScreen(b.u, b.v);
        if (inBox(pa) && inBox(pb)) this.edges.add(edge.key);
      }
    }
 
    if (this.mode === 'face') {
      for (const face of meshData.faces.values()) {
        const faceUVs = meshData.uvs.get(face.id);
        if (!this.isFaceUVComplete(face, faceUVs)) continue;
        const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
        if (screenPoints.every(inBox)) this.faces.add(face.id);
      }
    }

    this.resolveFromMode(topo);
  }

  // Mesh <-> UV translation
  _vertexPairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  _buildMeshEdgeLookup(meshData) {
    const lookup = new Map();
    for (const edge of meshData.edges.values()) {
      lookup.set(this._vertexPairKey(edge.v1Id, edge.v2Id), edge.id);
    }
    return lookup;
  }

  toMeshSelection(topo = this.buildTopology()) {
    const vertexIds = new Set();
    const edgeIds = new Set();
    const faceIds = new Set(this.faces);

    this.meshData = this.getMeshData();
    if (!this.meshData) return { vertexIds, edgeIds, faceIds };

    for (const key of this.vertices) {
      const point = topo.pointsByKey.get(key);
      if (point) vertexIds.add(point.vertexId);
    }

    const edgeLookup = this._buildMeshEdgeLookup(this.meshData);
    for (const key of this.edges) {
      const edge = topo.edgesByKey.get(key);
      if (!edge) continue;

      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      const id = edgeLookup.get(this._vertexPairKey(a.vertexId, b.vertexId));
      if (id !== undefined) edgeIds.add(id);
    }

    return { vertexIds, edgeIds, faceIds };
  }

  applyMeshSelection(state, topo = this.buildTopology()) {
    this.clear();
    
    const meshData = this.getMeshData();
    if (!meshData || !state) return;

    const { selectedVertexIds, selectedEdgeIds, selectedFaceIds } = state;

    if (this.mode === 'vertex') {
      for (const point of topo.points) {
        if (selectedVertexIds.has(point.vertexId)) this.vertices.add(point.key);
      }
    } else if (this.mode === 'edge') {
      const edgeLookup = this._buildMeshEdgeLookup(meshData);
      for (const edge of topo.edges) {
        const a = topo.pointsByKey.get(edge.aKey);
        const b = topo.pointsByKey.get(edge.bKey);
        if (!a || !b) continue;

        const id = edgeLookup.get(this._vertexPairKey(a.vertexId, b.vertexId));
        if (id !== undefined && selectedEdgeIds.has(id)) this.edges.add(edge.key);
      }
    } else {
      for (const faceId of selectedFaceIds) {
        if (topo.faceCornerKeys.has(faceId)) this.faces.add(faceId);
      }
    }

    this.resolveFromMode(topo);
  }
}