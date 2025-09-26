import * as THREE from 'three';
import earcut from 'earcut';

class Vertex {
  constructor(id, position) {
    this.id = id;
    this.position = position;
    this.edgeIds = new Set();
    this.faceIds = new Set();
  }
}

class Edge {
  constructor(id, v1Id, v2Id) {
    this.id = id;
    this.v1Id = v1Id;
    this.v2Id = v2Id;
    this.faceIds = new Set();
  }
}

class Face {
  constructor(id, vertexIds) {
    this.id = id;
    this.vertexIds = vertexIds;
    this.edgeIds = new Set();
  }
}

export class MeshData {
  constructor() {
    this.vertices = new Map();
    this.edges = new Map();
    this.faces = new Map();
    this.vertexIndexMap = new Map();
    this.nextVertexId = 0;
    this.nextEdgeId = 0;
    this.nextFaceId = 0;
  }

  addVertex(position) {
    const v = new Vertex(this.nextVertexId++, position);
    this.vertices.set(v.id, v);
    return v;
  }

  addEdge(v1, v2) {
    for (let edge of this.edges.values()) {
      if ((edge.v1Id === v1.id && edge.v2Id === v2.id) ||
          (edge.v1Id === v2.id && edge.v2Id === v1.id)) {
        return edge;
      }
    }
    const e = new Edge(this.nextEdgeId++, v1.id, v2.id);
    this.edges.set(e.id, e);
    v1.edgeIds.add(e.id);
    v2.edgeIds.add(e.id);
    return e;
  }

  addFace(vertexArray) {
    const vIds = vertexArray.map(v => v.id);
    const f = new Face(this.nextFaceId++, vIds);
    this.faces.set(f.id, f);

    const len = vIds.length;
    for (let i = 0; i < len; i++) {
      const v1Id = vIds[i];
      const v2Id = vIds[(i + 1) % len];
      const v1 = this.vertices.get(v1Id);
      const v2 = this.vertices.get(v2Id);
      const e = this.addEdge(v1, v2);
      f.edgeIds.add(e.id);
      e.faceIds.add(f.id);
    }

    for (let vId of vIds) {
      this.vertices.get(vId).faceIds.add(f.id);
    }

    return f;
  }

  toJSON() {
    return {
      vertices: Array.from(this.vertices.entries()).map(([id, v]) => [
        id,
        {
          id: v.id,
          position: v.position,
          edgeIds: Array.from(v.edgeIds),
          faceIds: Array.from(v.faceIds)
        }
      ]),
      edges: Array.from(this.edges.entries()).map(([id, e]) => [
        id,
        {
          id: e.id,
          v1Id: e.v1Id,
          v2Id: e.v2Id,
          faceIds: Array.from(e.faceIds)
        }
      ]),
      faces: Array.from(this.faces.entries()).map(([id, f]) => [
        id,
        {
          id: f.id,
          vertexIds: f.vertexIds,
          edgeIds: Array.from(f.edgeIds)
        }
      ]),
      vertexIndexMap: Array.from(this.vertexIndexMap.entries()),
      nextVertexId: this.nextVertexId,
      nextEdgeId: this.nextEdgeId,
      nextFaceId: this.nextFaceId
    };
  }

  static rehydrateMeshData(object) {
    if (object.userData.meshData && !(object.userData.meshData instanceof MeshData)) {
      const raw = object.userData.meshData;
      const meshData = Object.assign(new MeshData(), raw);

      if (raw.vertices instanceof Map) {
        meshData.vertices = raw.vertices;
      } else if (Array.isArray(raw.vertices)) {
        meshData.vertices = new Map(
          raw.vertices.map(([id, v]) => {
            const vertex = Object.assign(new Vertex(v.id, v.position), v);
            vertex.edgeIds = new Set(v.edgeIds || []);
            vertex.faceIds = new Set(v.faceIds || []);
            return [id, vertex];
          })
        );
      }

      if (raw.edges instanceof Map) {
        meshData.edges = raw.edges;
      } else if (Array.isArray(raw.edges)) {
        meshData.edges = new Map(
          raw.edges.map(([id, e]) => {
            const edge = Object.assign(new Edge(e.id, e.v1Id, e.v2Id), e);
            edge.faceIds = new Set(e.faceIds || []);
            return [id, edge];
          })
        );
      }

      if (raw.faces instanceof Map) {
        meshData.faces = raw.faces;
      } else if (Array.isArray(raw.faces)) {
        meshData.faces = new Map(
          raw.faces.map(([id, f]) => {
            const face = Object.assign(new Face(f.id, f.vertexIds), f);
            face.edgeIds = new Set(f.edgeIds || []);
            return [id, face];
          })
        );
      }

      meshData.vertexIndexMap = new Map(raw.vertexIndexMap);
      meshData.nextVertexId = raw.nextVertexId;
      meshData.nextEdgeId = raw.nextEdgeId;
      meshData.nextFaceId = raw.nextFaceId;

      object.userData.meshData = meshData;
    }

    for (const child of object.children) {
      this.rehydrateMeshData(child);
    }
  }

  toDuplicatedVertexGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    let currentIndex = 0;

    this.vertexIndexMap.clear();

    for (let f of this.faces.values()) {
      const verts = f.vertexIds.map(id => this.vertices.get(id));

      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);

        if (!this.vertexIndexMap.has(v.id)) this.vertexIndexMap.set(v.id, []);
        this.vertexIndexMap.get(v.id).push(currentIndex);

        currentIndex++;
      }

      const normal = this.computePlaneNormal(verts);
      const flatVertices = this.projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);

      const baseIndex = currentIndex - verts.length;
      for (let i = 0; i < triangulated.length; i += 3) {
        indices.push(
          baseIndex + triangulated[i],
          baseIndex + triangulated[i + 1],
          baseIndex + triangulated[i + 2]
        );
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  toSharedVertexGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];

    this.vertexIndexMap.clear();
    const vertexIdToIndex = new Map();
    let currentIndex = 0;

    for (let v of this.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      vertexIdToIndex.set(v.id, currentIndex);

      this.vertexIndexMap.set(v.id, [currentIndex]);
      currentIndex++;
    }

    for (let f of this.faces.values()) {
      const verts = f.vertexIds.map(id => this.vertices.get(id));

      const normal = this.computePlaneNormal(verts);
      const flatVertices = this.projectTo2D(verts, normal);

      const triangulated = earcut(flatVertices);

      for (let i = 0; i < triangulated.length; i += 3) {
        const a = vertexIdToIndex.get(verts[triangulated[i]].id);
        const b = vertexIdToIndex.get(verts[triangulated[i + 1]].id);
        const c = vertexIdToIndex.get(verts[triangulated[i + 2]].id);

        indices.push(a, b, c);
      }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  toAngleBasedGeometry(angleDegree = 60) {
    const threshold = Math.cos(THREE.MathUtils.degToRad(angleDegree));

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    this.vertexIndexMap.clear();

    const faceNormals = this.computeFaceNormals();

    // --- 1. Build edgeKey -> faceIds from existing edges ---
    const edgeToFaces = new Map();
    for (let e of this.edges.values()) {
      const edgeKey = e.v1Id < e.v2Id ? `${e.v1Id}_${e.v2Id}` : `${e.v2Id}_${e.v1Id}`;
      edgeToFaces.set(edgeKey, Array.from(e.faceIds));
    }

    // --- 2. Mark smooth vs sharp edges ---
    const smoothEdges = new Set();
    for (let [edgeKey, faces] of edgeToFaces) {
      if (faces.length === 2) {
        const [f1, f2] = faces;
        const n1 = faceNormals.get(f1);
        const n2 = faceNormals.get(f2);
        if (n1.dot(n2) >= threshold) {
          smoothEdges.add(edgeKey);
        }
      }
    }

    // --- 3. Build smoothing groups per vertex ---
    const vertexGroups = new Map();
    let currentIndex = 0;

    const getOrCreateGroup = (vId, faceId) => {
      if (!vertexGroups.has(vId)) vertexGroups.set(vId, []);

      for (let g of vertexGroups.get(vId)) {
        if (g.connectedFaces.has(faceId)) return g;
      }

      const v = this.vertices.get(vId);
      positions.push(v.position.x, v.position.y, v.position.z);

      const group = {
        index: currentIndex++,
        faces: new Set([faceId]),
        connectedFaces: new Set([faceId])
      };
      vertexGroups.get(vId).push(group);

      return group;
    };

    // --- 4. Assign vertex indices using smoothing groups ---
    for (let f of this.faces.values()) {
      const verts = f.vertexIds;
      const faceIndices = [];

      for (let vId of verts) {
        let group = null;

        // Check adjacent faces via smooth edges
        for (let i = 0; i < verts.length; i++) {
          const v1 = verts[i];
          const v2 = verts[(i + 1) % verts.length];
          if (v1 !== vId && v2 !== vId) continue;

          const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
          if (smoothEdges.has(edgeKey)) {
            const neighborFaces = edgeToFaces.get(edgeKey);
            for (let nf of neighborFaces) {
              if (nf !== f.id) {
                const groups = vertexGroups.get(vId) || [];
                group = groups.find(g => g.faces.has(nf));
                if (group) break;
              }
            }
          }
          if (group) break;
        }

        if (!group) group = getOrCreateGroup(vId, f.id);

        group.faces.add(f.id);
        group.connectedFaces.add(f.id);

        if (!this.vertexIndexMap.has(vId)) this.vertexIndexMap.set(vId, []);
        this.vertexIndexMap.get(vId).push(group.index);

        faceIndices.push(group.index);
      }

      const vertsObjs = verts.map(id => this.vertices.get(id));
      const normal = this.computePlaneNormal(vertsObjs);
      const flatVertices2D = this.projectTo2D(vertsObjs, normal);

      const triangulated = earcut(flatVertices2D);

      for (let i = 0; i < triangulated.length; i += 3) {
        const a = faceIndices[triangulated[i]];
        const b = faceIndices[triangulated[i + 1]];
        const c = faceIndices[triangulated[i + 2]];
        indices.push(a, b, c);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  static fromOBJText(objText) {
    const lines = objText.split('\n');
    const objects = [];
    let current = { name: '', positions: [], faces: [], vertexOffset: 0 };

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 0) continue;

      switch (parts[0]) {
        case 'o':
        case 'g':
          if (current.faces.length > 0) {
            objects.push(current);
            current.vertexOffset += current.positions.length;
          }
          current = { 
            name: parts.slice(1).join(' '), 
            positions: [], 
            faces: [], 
            vertexOffset: current.vertexOffset 
          };
          break;

        case 'v':
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);

          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
            current.positions.push(null);
          } else {
            current.positions.push([x, y, z]);
          }
          break;

        case 'f':
          const faceIndices = parts.slice(1).map(token => {
            const idx = parseInt(token.split('/')[0], 10) - 1 - current.vertexOffset;
            return idx;
          });
          current.faces.push(faceIndices);
          break;
      }
    }
    
    if (current.faces.length > 0) objects.push(current);

    return objects.map(obj => {
      const { positions, faces, name } = obj;
      const meshData = new MeshData();
      const verts = positions.map(p => p ? meshData.addVertex(new THREE.Vector3(...p)) : null);
      for (const face of faces) {
        const vertexArray = face.map(i => verts[i]).filter(v => v !== null);
        if (vertexArray.length >= 3) meshData.addFace(vertexArray);
      }
      return { name, meshData };
    });
  }

  computePerVertexNormals() {
    const normals = new Map();

    for (const [vid, v] of this.vertices) {
      normals.set(vid, new THREE.Vector3(0, 0, 0));
    }

    for (const [, f] of this.faces) {
      const vIds = f.vertexIds;
      if (vIds.length < 3) continue;

      const p0 = this.vertices.get(vIds[0]).position;
      const p1 = this.vertices.get(vIds[1]).position;
      const p2 = this.vertices.get(vIds[2]).position;

      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const faceNormal = new THREE.Vector3().crossVectors(e1, e2);

      if (faceNormal.lengthSq() === 0) continue;
      faceNormal.normalize();

      for (const vid of vIds) {
        normals.get(vid).add(faceNormal);
      }
    }

    for (const [vid, n] of normals) {
      if (n.lengthSq() === 0) n.set(0, 0, 1);
      else n.normalize();
    }

    return normals;
  }

  computeFaceNormals() {
    const faceNormals = new Map();

    for (let [fid, f] of this.faces) {
      if (f.vertexIds.length < 3) continue;

      const v0 = this.vertices.get(f.vertexIds[0]).position;
      const v1 = this.vertices.get(f.vertexIds[1]).position;
      const v2 = this.vertices.get(f.vertexIds[2]).position;

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2);

      if (normal.lengthSq() === 0) {
        normal.set(0, 0, 1);
      } else {
        normal.normalize();
      }

      faceNormals.set(fid, normal);
    }

    return faceNormals;
  }

  computeVertexNormalsWithAngle(angleDeg = 60) {
    const angleLimit = THREE.MathUtils.degToRad(angleDeg);
    const cosLimit = Math.cos(angleLimit);

    const faceNormals = this.computeFaceNormals();
    const result = new Map();

    // Build adjacency: vertex → faces
    const vertexToFaces = new Map();
    for (const [fid, f] of this.faces) {
      for (const vid of f.vertexIds) {
        if (!vertexToFaces.has(vid)) vertexToFaces.set(vid, []);
        vertexToFaces.get(vid).push(fid);
      }
    }

    // Build face adjacency through edges
    const edgeToFaces = new Map();
    for (let e of this.edges.values()) {
      const edgeKey = e.v1Id < e.v2Id ? `${e.v1Id}_${e.v2Id}` : `${e.v2Id}_${e.v1Id}`;
      edgeToFaces.set(edgeKey, Array.from(e.faceIds));
    }

    // For each vertex, flood-fill connected faces into smoothing groups
    for (const [vid, faceIds] of vertexToFaces) {
      const unvisited = new Set(faceIds);
      while (unvisited.size > 0) {
        const groupFaces = [];
        const stack = [unvisited.values().next().value];
        const avgNormal = new THREE.Vector3();

        while (stack.length > 0) {
          const fid = stack.pop();
          if (!unvisited.has(fid)) continue;
          unvisited.delete(fid);

          const fn = faceNormals.get(fid);
          groupFaces.push(fid);
          avgNormal.add(fn);

          // Explore neighbors of fid around vid
          const face = this.faces.get(fid);
          for (let i = 0; i < face.vertexIds.length; i++) {
            const v1 = face.vertexIds[i];
            const v2 = face.vertexIds[(i + 1) % face.vertexIds.length];
            if (v1 !== vid && v2 !== vid) continue;

            const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            const neighbors = edgeToFaces.get(edgeKey) || [];
            for (const nf of neighbors) {
              if (unvisited.has(nf)) {
                const dot = fn.dot(faceNormals.get(nf));
                if (dot >= cosLimit) stack.push(nf);
              }
            }
          }
        }

        // Finalize average normal for this group
        avgNormal.normalize();
        for (const fid of groupFaces) {
          result.set(`${fid}_${vid}`, avgNormal.clone());
        }
      }
    }

    return result;
  }

  computePlaneNormal(verts) {
    if (verts.length < 3) return new THREE.Vector3(0, 0, 1);
    const v0 = verts[0].position;
    const v1 = verts[1].position;
    const v2 = verts[2].position;

    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);

    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    return normal;
  }

  projectTo2D(verts, normal) {
    let tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.99) tangent.set(0, 1, 0);

    const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const origin = verts[0].position;
    const flat = [];

    for (let vert of verts) {
        const p = new THREE.Vector3().subVectors(vert.position, origin);
        flat.push(p.dot(u), p.dot(v));
    }

    return flat;
  }
}