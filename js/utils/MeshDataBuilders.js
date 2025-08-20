import { MeshData } from '../core/MeshData.js';

export class MeshDataBuilders {
  static createCubeMeshData() {
    const meshData = new MeshData();
    const v0 = meshData.addVertex({ x: -0.5, y: -0.5, z: -0.5 });
    const v1 = meshData.addVertex({ x:  0.5, y: -0.5, z: -0.5 });
    const v2 = meshData.addVertex({ x:  0.5, y:  0.5, z: -0.5 });
    const v3 = meshData.addVertex({ x: -0.5, y:  0.5, z: -0.5 });

    const v4 = meshData.addVertex({ x: -0.5, y: -0.5, z:  0.5 });
    const v5 = meshData.addVertex({ x:  0.5, y: -0.5, z:  0.5 });
    const v6 = meshData.addVertex({ x:  0.5, y:  0.5, z:  0.5 });
    const v7 = meshData.addVertex({ x: -0.5, y:  0.5, z:  0.5 });

    meshData.addFace([v3, v2, v1, v0]);
    meshData.addFace([v4, v5, v6, v7]);
    meshData.addFace([v0, v4, v7, v3]);
    meshData.addFace([v2, v6, v5, v1]);
    meshData.addFace([v3, v7, v6, v2]);
    meshData.addFace([v1, v5, v4, v0]);
    return meshData;
  }

  static createCircleMeshData() {
    const meshData = new MeshData();
    const segments = 32;
    const radius = 0.5;
    const center = meshData.addVertex({ x: 0, y: 0, z: 0 });

    const vertices = [];

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const v = meshData.addVertex({ x, y: 0, z });
      vertices.push(v);
    }

    for (let i = 0; i < segments; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % segments];
      meshData.addFace([center, v2, v1]);
    }
    return meshData;
  }

  static createPlaneMeshData() {
    const meshData = new MeshData();
    const v0 = meshData.addVertex({ x: -0.5, y: 0, z: -0.5 });
    const v1 = meshData.addVertex({ x:  0.5, y: 0, z: -0.5 });
    const v2 = meshData.addVertex({ x:  0.5, y: 0, z:  0.5 });
    const v3 = meshData.addVertex({ x: -0.5, y: 0, z:  0.5 });

    meshData.addFace([v3, v2, v1, v0]);
    return meshData;
  }

  static createSphereMeshData() {
    const meshData = new MeshData();
    const vertices = [];

    const radius = 0.5;
    const widthSegments = 16;
    const heightSegments = 12;

    // --- Top pole ---
    const topVertex = meshData.addVertex({ x: 0, y: radius, z: 0 });

    // --- Middle latitude vertices ---
    for (let y = 1; y < heightSegments; y++) {
      const v = y / heightSegments;
      const phi = v * Math.PI;

      for (let x = 0; x < widthSegments; x++) {
        const u = x / widthSegments;
        const theta = u * Math.PI * 2;

        const vx = radius * Math.sin(phi) * Math.cos(theta);
        const vy = radius * Math.cos(phi);
        const vz = radius * Math.sin(phi) * Math.sin(theta);

        vertices.push(meshData.addVertex({ x: vx, y: vy, z: vz }));
      }
    }

    // --- Bottom pole ---
    const bottomVertex = meshData.addVertex({ x: 0, y: -radius, z: 0 });

    // --- Top cap faces ---
    for (let x = 0; x < widthSegments; x++) {
      const a = x;
      const b = (x + 1) % widthSegments;
      meshData.addFace([vertices[b], vertices[a], topVertex]);
    }

    // --- Middle quads ---
    for (let y = 0; y < heightSegments - 2; y++) {
      for (let x = 0; x < widthSegments; x++) {
        const rowStart = y * widthSegments;
        const a = rowStart + x;
        const b = rowStart + ((x + 1) % widthSegments);
        const c = b + widthSegments;
        const d = a + widthSegments;

        meshData.addFace([vertices[b], vertices[c], vertices[d], vertices[a]]);
      }
    }

    // --- Bottom cap faces ---
    const bottomRowStart = vertices.length - widthSegments;
    for (let x = 0; x < widthSegments; x++) {
      const a = bottomRowStart + x;
      const b = bottomRowStart + ((x + 1) % widthSegments);
      meshData.addFace([vertices[b], bottomVertex, vertices[a]]);
    }

    return meshData;
  }

  static createCylinderMeshData() {
    const meshData = new MeshData();

    const radius = 0.5;
    const height = 1.0;
    const radialSegments = 16;

    const halfHeight = height * 0.5;
    const bottomRing = [];
    const topRing = [];

    // --- Create vertices ---
    // Only go to < radialSegments to avoid duplicate seam vertex
    for (let i = 0; i < radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);

      bottomRing.push(meshData.addVertex({ x, y: -halfHeight, z }));
      topRing.push(meshData.addVertex({ x, y:  halfHeight, z }));
    }

    // Centers for caps
    const bottomCenter = meshData.addVertex({ x: 0, y: -halfHeight, z: 0 });
    const topCenter = meshData.addVertex({ x: 0, y: halfHeight, z: 0 });

    // --- Create faces ---
    // Side quads (wrap around with %)
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;

      const b0 = bottomRing[i];
      const b1 = bottomRing[next];
      const t0 = topRing[i];
      const t1 = topRing[next];

      meshData.addFace([t0, t1, b1, b0]);
    }

    // Bottom cap (triangles)
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      meshData.addFace([bottomRing[i], bottomRing[next], bottomCenter]);
    }

    // Top cap (triangles)
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      meshData.addFace([topRing[next], topRing[i], topCenter]);
    }

    return meshData;
  }

  static createConeMeshData() {
    const meshData = new MeshData();

    const radius = 0.5;
    const height = 1.0;
    const radialSegments = 16;
    const halfHeight = height * 0.5;

    const bottomRing = [];

    // --- Base ring vertices ---
    for (let i = 0; i < radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);
      bottomRing.push(meshData.addVertex({ x, y: -halfHeight, z }));
    }

    // --- Apex and base center vertices ---
    const apex = meshData.addVertex({ x: 0, y: halfHeight, z: 0 });
    const baseCenter = meshData.addVertex({ x: 0, y: -halfHeight, z: 0 });

    // --- Side faces (triangle fan from apex) ---
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      meshData.addFace([bottomRing[next], bottomRing[i], apex]);
    }

    // --- Base cap (triangle fan) ---
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      meshData.addFace([bottomRing[i], bottomRing[next], baseCenter]);
    }

    return meshData;
  }

  static createTorusMeshData() {
    const meshData = new MeshData();

    const radius = 0.5;
    const tubeRadius = 0.2;
    const radialSegments = 24;
    const tubularSegments = 12;

    // --- Create vertices as a 2D grid ---
    const vertices = Array(radialSegments)
      .fill(null)
      .map(() => Array(tubularSegments));

    for (let j = 0; j < radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);

      for (let i = 0; i < tubularSegments; i++) {
        const u = (i / tubularSegments) * Math.PI * 2;
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);

        const x = (radius + tubeRadius * cosU) * cosV;
        const y = tubeRadius * sinU;
        const z = (radius + tubeRadius * cosU) * sinV;

        vertices[j][i] = meshData.addVertex({ z, y, x });
      }
    }

    // --- Create quad faces using wrapping indices ---
    for (let j = 0; j < radialSegments; j++) {
      const jNext = (j + 1) % radialSegments;

      for (let i = 0; i < tubularSegments; i++) {
        const iNext = (i + 1) % tubularSegments;

        const a = vertices[j][i];
        const b = vertices[jNext][i];
        const c = vertices[jNext][iNext];
        const d = vertices[j][iNext];

        meshData.addFace([d, c, b, a]);
      }
    }

    return meshData;
  }
}