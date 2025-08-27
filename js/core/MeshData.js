import * as THREE from 'three';
import { quadrangulateGeometry } from '../utils/QuadrangulateGeometry.js';
import { weldVertices } from '../utils/WeldVertices.js';

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

  toBufferGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    let currentIndex = 0;
    const vertexIndexMap = new Map();

    for (let f of this.faces.values()) {
      const verts = f.vertexIds.map(id => this.vertices.get(id));

      const baseIndex = currentIndex;
      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);

        if (!vertexIndexMap.has(v.id)) vertexIndexMap.set(v.id, []);
        vertexIndexMap.get(v.id).push(currentIndex);

        currentIndex++;
      }

      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return { geometry, vertexIndexMap };
  }

  static fromFBXGeometry(geometry) {
    geometry = weldVertices(geometry);
    const { quads, triangles } = quadrangulateGeometry(geometry);

    const meshData = new MeshData();
    const posAttr = geometry.getAttribute('position');
    const verts = [];
    for (let i = 0; i < posAttr.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      verts.push(meshData.addVertex(p));
    }

    for (const q of quads) {
      meshData.addFace([verts[q[0]], verts[q[1]], verts[q[2]], verts[q[3]]]);
    }

    for (const t of triangles) {
      meshData.addFace([verts[t[0]], verts[t[1]], verts[t[2]]]);
    }
    return meshData;
  }
}