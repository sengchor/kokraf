const UV_WELD_EPSILON = 1e-5;

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

  _computeTopology(meshData) {
    const topo = {
      points: [],
      pointsByKey: new Map(),
      cornerToPointKey: new Map(),
      edges: [],
      edgesByKey: new Map(),
      faceCornerKeys: new Map(),
      faceEdgeKeys: new Map()
    };
    if (!meshData) return topo;

    const { points, pointsByKey, cornerToPointKey, edgesByKey, faceCornerKeys, faceEdgeKeys } = topo;
    const eps = UV_WELD_EPSILON;

    // 1. Gather UV corners per mesh vertex (valid faces only).
    const faces = [];
    const cornersByVertex = new Map();

    for (const face of meshData.faces.values()) {
      const uvs = meshData.uvs.get(face.id);
      if (!this.isFaceUVComplete(face, uvs)) continue;
      faces.push(face);

      face.vertexIds.forEach((vertexId, corner) => {
        let list = cornersByVertex.get(vertexId);
        if (!list) cornersByVertex.set(vertexId, list = []);
        list.push({ faceId: face.id, corner, u: uvs[corner].u, v: uvs[corner].v });
      });
    }

    // 2. Weld corners of the same vertex that share a UV position into points.
    for (const [vertexId, corners] of cornersByVertex) {
      const clusters = [];
      for (const c of corners) {
        let cl = clusters.find(k => Math.abs(k.u - c.u) <= eps && Math.abs(k.v - c.v) <= eps);
        if (!cl) clusters.push(cl = { u: c.u, v: c.v, corners: [] });
        cl.corners.push(c);
      }

      for (const cl of clusters) {
        const rep = cl.corners[0];
        const key = `${rep.faceId}_${rep.corner}`;
        const point = { key, vertexId, u: cl.u, v: cl.v, corners: cl.corners };
        points.push(point);
        pointsByKey.set(key, point);
        for (const c of cl.corners) cornerToPointKey.set(`${c.faceId}_${c.corner}`, key);
      }
    }

    // 3. Build edges and per-face key lists.
    for (const face of faces) {
      const n = face.vertexIds.length;
      const cornerKeys = new Array(n);
      const edgeKeys = new Array(n);

      for (let i = 0; i < n; i++) cornerKeys[i] = cornerToPointKey.get(`${face.id}_${i}`);

      for (let i = 0; i < n; i++) {
        const a = cornerKeys[i];
        const b = cornerKeys[(i + 1) % n];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;

        let edge = edgesByKey.get(key);
        if (!edge) edgesByKey.set(key, edge = { key, aKey: a, bKey: b, faceIds: new Set() });
        edge.faceIds.add(face.id);
        edgeKeys[i] = key;
      }

      faceCornerKeys.set(face.id, cornerKeys);
      faceEdgeKeys.set(face.id, edgeKeys);
    }

    topo.edges = Array.from(edgesByKey.values());
    return topo;
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