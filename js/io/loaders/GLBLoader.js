import * as THREE from 'three';
import { MeshData } from '../../core/MeshData.js';
import { SharpUtils } from '../../utils/SharpUtils.js';

export default class GLBLoader {
  static async fromArrayBuffer(arrayBuffer, siblingFiles = []) {
    const { GLTFLoader } = await import('jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('jsm/loaders/DRACOLoader.js');

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const filename = url.split('/').pop();
      const match = siblingFiles.find(f => f.name === filename);
      if (match) return URL.createObjectURL(match);
      return url;
    });

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('three/examples/jsm/libs/draco/gltf/');

    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(dracoLoader);

    const gltf = await new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));

    dracoLoader.dispose();

    // matrixWorld isn't guaranteed to be up to date right after parsing
    gltf.scene.updateMatrixWorld(true);

    const objects = [];
    gltf.scene.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const mesh = GLBLoader._readMesh(child);
      if (mesh) objects.push(mesh);
    });

    return objects.map(mesh => GLBLoader._buildMeshData(mesh));
  }

  // Read one THREE.Mesh into world-space positions (merged) + triangles with per-corner uv/normal
  static _readMesh(child) {
    const geometry = child.geometry;
    const positionAttr = geometry.attributes.position;
    if (!positionAttr) return null;

    const normalAttr = geometry.attributes.normal;
    const uvAttr = geometry.attributes.uv;
    const indexAttr = geometry.index;

    const world = child.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    const mirrored = world.determinant() < 0; // negative scale flips winding

    // Merge vertices by position so shared edges stay connected
    const positions = [];
    const posToIdx = new Map();
    const rawToMerged = new Array(positionAttr.count);
    const p = new THREE.Vector3();

    for (let i = 0; i < positionAttr.count; i++) {
      p.fromBufferAttribute(positionAttr, i).applyMatrix4(world);
      // Round to avoid floating-point noise from matrix math.
      const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`;
      let idx = posToIdx.get(key);
      if (idx === undefined) {
        idx = positions.length;
        posToIdx.set(key, idx);
        positions.push([p.x, p.y, p.z]);
      }
      rawToMerged[i] = idx;
    }

    // World-space normal per raw vertex (computed lazily, shared by all corners using it)
    const normalCache = normalAttr ? new Array(normalAttr.count) : null;
    const normalAt = (raw) => {
      if (!normalAttr) return null;
      let n = normalCache[raw];
      if (n === undefined) {
        n = new THREE.Vector3().fromBufferAttribute(normalAttr, raw).applyMatrix3(normalMatrix);
        n = n.lengthSq() > 0 ? n.normalize() : null;
        normalCache[raw] = n;
      }
      return n;
    };

    const corner = (raw) => ({
      v: rawToMerged[raw],
      uv: uvAttr ? { u: uvAttr.getX(raw), v: 1.0 - uvAttr.getY(raw) } : null,
      n: normalAt(raw),
    });

    const triangles = [];
    const count = indexAttr ? indexAttr.count : positionAttr.count;
    const rawIndex = (i) => (indexAttr ? indexAttr.getX(i) : i);

    for (let i = 0; i + 2 < count; i += 3) {
      const tri = mirrored
        ? [corner(rawIndex(i)), corner(rawIndex(i + 2)), corner(rawIndex(i + 1))]
        : [corner(rawIndex(i)), corner(rawIndex(i + 1)), corner(rawIndex(i + 2))];

      // Skip triangles that collapse after merging (zero-area slivers, pole caps, etc.)
      if (tri[0].v === tri[1].v || tri[1].v === tri[2].v || tri[0].v === tri[2].v) continue;

      triangles.push(tri);
    }

    return {
      name: child.name || '',
      positions,
      triangles,
      hasUVs: !!uvAttr,
      hasNormals: !!normalAttr,
    };
  }

  static _buildMeshData({ name, positions, triangles, hasUVs, hasNormals }) {
    const meshData = new MeshData();
    const verts = positions.map(p => meshData.addVertex(new THREE.Vector3(...p)));

    // faceId -> { smooth, group, normals: Map<vertexId, Vector3|null> }
    const faceInfo = new Map();

    for (const tri of triangles) {
      const face = meshData.addFace(tri.map(c => verts[c.v]));
      if (!face) continue;

      if (hasUVs) meshData.uvs.set(face.id, tri.map(c => c.uv));

      const normals = new Map();
      for (const c of tri) normals.set(verts[c.v].id, c.n);
      faceInfo.set(face.id, { smooth: hasNormals, group: 0, normals });
    }

    const { shading, angle, sharps } = SharpUtils.detectSharps(meshData, faceInfo);
    return { name, meshData, shading, angle, sharps };
  }
}