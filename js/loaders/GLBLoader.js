import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

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

    const objects = [];

    gltf.scene.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;

      const current = { name: child.name || '', positions: [], faces: [], uvs: [] };

      const geometry = child.geometry.clone();
      const srcGeo = geometry.index ? geometry : geometry.toNonIndexed();
      
      const positionAttr = srcGeo.attributes.position;
      const uvAttr = srcGeo.attributes.uv;
      const indexAttr    = srcGeo.index;
      if (!positionAttr) return;

      // Deduplicate vertices by position so shared edges stay connected
      const posToIdx = new Map();
      const rawToDedup = [];

      for (let i = 0; i < positionAttr.count; i++) {
        const p = new THREE.Vector3(
          positionAttr.getX(i),
          positionAttr.getY(i),
          positionAttr.getZ(i),
        ).applyMatrix4(child.matrixWorld);

        // Round to avoid floating-point noise from matrix math
        const key = `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
        if (!posToIdx.has(key)) {
          posToIdx.set(key, current.positions.length);
          current.positions.push([p.x, p.y, p.z]);
        }
        rawToDedup.push(posToIdx.get(key));
      }

      // Build faces using deduplicated indices
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          const idx0 = indexAttr.getX(i);
          const idx1 = indexAttr.getX(i + 1);
          const idx2 = indexAttr.getX(i + 2);

          current.faces.push([rawToDedup[idx0], rawToDedup[idx1], rawToDedup[idx2]]);

          if (uvAttr) {
            current.uvs.push([
              { u: uvAttr.getX(idx0), v: 1.0 - uvAttr.getY(idx0) },
              { u: uvAttr.getX(idx1), v: 1.0 - uvAttr.getY(idx1) },
              { u: uvAttr.getX(idx2), v: 1.0 - uvAttr.getY(idx2) }
            ]);
          }
        }
      } else {
        for (let i = 0; i < positionAttr.count; i += 3) {
          current.faces.push([rawToDedup[i], rawToDedup[i + 1], rawToDedup[i + 2]]);

          if (uvAttr) {
            current.uvs.push([
              { u: uvAttr.getX(i), v: 1.0 - uvAttr.getY(i) },
              { u: uvAttr.getX(i + 1), v: 1.0 - uvAttr.getY(i + 1) },
              { u: uvAttr.getX(i + 2), v: 1.0 - uvAttr.getY(i + 2) }
            ]);
          }
        }
      }

      objects.push(current);
    });

    return objects.map((obj) => {
      const { positions, faces, uvs, name } = obj;
      const meshData = new MeshData();
      const verts = positions.map(p => p ? meshData.addVertex(new THREE.Vector3(...p)) : null);
      
      for (let i = 0; i < faces.length; i++) {
        const faceIndices = faces[i];
        const vertexArray = faceIndices.map(idx => verts[idx]).filter(v => v !== null && v !== undefined);

        if (vertexArray.length >= 3) {
          const addedFace = meshData.addFace(vertexArray);

          if (uvs.length > 0 && addedFace) {
            meshData.uvs.set(addedFace.id, uvs[i]);
          }
        }
      }

      const expectedTris = obj.faces.length;

      return { name, meshData };
    });
  }
}