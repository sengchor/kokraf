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

      const current = { name: child.name || '', positions: [], faces: [] };

      const geometry = child.geometry.clone();
      const srcGeo = geometry.index ? geometry : geometry.toNonIndexed();
      const positionAttr = srcGeo.attributes.position;
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
          current.faces.push([
            rawToDedup[indexAttr.getX(i)],
            rawToDedup[indexAttr.getX(i + 1)],
            rawToDedup[indexAttr.getX(i + 2)],
          ]);
        }
      } else {
        for (let i = 0; i < positionAttr.count; i += 3) {
          current.faces.push([rawToDedup[i], rawToDedup[i + 1], rawToDedup[i + 2]]);
        }
      }

      objects.push(current);
    });

    return objects.map((obj) => {
      const { positions, faces, name } = obj;
      const meshData = new MeshData();
      const verts = positions.map(p => p ? meshData.addVertex(new THREE.Vector3(...p)) : null);
      for (const face of faces) {
        const vertexArray = face.map(i => verts[i]).filter(v => v !== null && v !== undefined);
        if (vertexArray.length >= 3) meshData.addFace(vertexArray);
      }
      return { name, meshData };
    });
  }
}