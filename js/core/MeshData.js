import * as THREE from 'three';

class Vertex {
  constructor(id, position) {
    this.id = id;
    this.position = position;
    this.edges = new Set();
    this.faces = new Set();
  }
}

class Edge {
  constructor(id, v1, v2) {
    this.id = id;
    this.v1 = v1;
    this.v2 = v2;
    this.faces = new Set();
  }
}

class Face {
  constructor(id, vertices) {
    this.id = id;
    this.vertices = vertices;
    this.edges = new Set();
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
      if ((edge.v1 === v1 && edge.v2 === v2) || (edge.v1 === v2 && edge.v2 === v1)) {
        return edge;
      }
    }
    const e = new Edge(this.nextEdgeId++, v1, v2);
    this.edges.set(e.id, e);
    v1.edges.add(e);
    v2.edges.add(e);
    return e;
  }

  addFace(vertexArray) {
    const f = new Face(this.nextFaceId++, vertexArray);
    this.faces.set(f.id, f);

    const len = vertexArray.length;
    for (let i = 0; i < len; i++) {
      const v1 = vertexArray[i];
      const v2 = vertexArray[(i + 1) % len];
      const e = this.addEdge(v1, v2);
      f.edges.add(e);
      e.faces.add(f);
    }

    for (let v of vertexArray) {
      v.faces.add(f);
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
      const verts = f.vertices;

      // fan triangulation, but duplicate vertices for each corner
      const baseIndex = currentIndex;

      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);

        if (!vertexIndexMap.has(v.id)) {
          vertexIndexMap.set(v.id, []);
        }
        vertexIndexMap.get(v.id).push(currentIndex);

        currentIndex++;
      }

      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(
          baseIndex,
          baseIndex + i,
          baseIndex + i + 1
        );
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return { geometry, vertexIndexMap };
  }
}