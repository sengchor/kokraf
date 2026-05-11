import * as THREE from 'three';
import earcut from 'earcut';
import XAtlas from 'xatlas-web';
import { computePlaneNormal, projectTo2D } from '../geometry/TriangulationUtils.js';

let _xatlasModule = null;

async function getXAtlasModule() {
  if (_xatlasModule) return _xatlasModule;

  const wasmUrl = new URL(
    'https://cdn.jsdelivr.net/npm/xatlas-web@0.1.0/dist/xatlas-web.wasm',
    import.meta.url
  ).toString();

  const instance = await XAtlas({
    locateFile(path) {
      return path.endsWith('.wasm') ? wasmUrl : path;
    }
  });

  _xatlasModule = instance;
  await _xatlasModule.ready;

  return _xatlasModule;
}

export class AutoUVUnwrap {
  static async unwrap(meshData) {
    const inputMesh = this._buildInputMesh(meshData);
    const output = await this._runXAtlas(inputMesh);

    this._applyUVsToMeshData(meshData, output, inputMesh.triangleFaceMap);

    return output;
  }

  static _buildInputMesh(meshData) {
    const positions = [];
    const indices = [];
    const triangleFaceMap = [];

    const vertexToBufIdx = new Map();
    for (const [vId, vertex] of meshData.vertices) {
      vertexToBufIdx.set(vId, positions.length / 3);
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
    }

    for (const face of meshData.faces.values()) {
      const vIds = face.vertexIds;
      const verts = vIds.map(id => meshData.vertices.get(id));

      const normal = computePlaneNormal(verts);
      const flat2D = projectTo2D(verts, normal);
      const localTris = earcut(flat2D);

      for (let i = 0; i < localTris.length; i += 3) {
        const s0 = localTris[i], s1 = localTris[i+1], s2 = localTris[i+2];
        indices.push(
          vertexToBufIdx.get(vIds[s0]),
          vertexToBufIdx.get(vIds[s1]),
          vertexToBufIdx.get(vIds[s2]),
        );
        triangleFaceMap.push({ faceId: face.id, slots: [s0, s1, s2] });
      }
    }

    // Compute smooth normals
    const tmpGeo = new THREE.BufferGeometry();
    tmpGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tmpGeo.setIndex(indices);
    tmpGeo.computeVertexNormals();
    const normals = new Float32Array(tmpGeo.attributes.normal.array);
    tmpGeo.dispose();
 
    return {
      positions: new Float32Array(positions),
      normals,
      indices: new Uint32Array(indices),
      triangleFaceMap,
    };
  }

  static async _runXAtlas(inputMesh) {
    const xa = await getXAtlasModule();
  
    xa.createAtlas();

    const vertexCount = inputMesh.positions.length / 3;
    const indexCount  = inputMesh.indices.length;

    const meshInfo = xa.createMesh(vertexCount, indexCount, true, true);
  
    xa.HEAPU16.set(inputMesh.indices, meshInfo.indexOffset / Uint16Array.BYTES_PER_ELEMENT); 
    xa.HEAPF32.set(inputMesh.positions, meshInfo.positionOffset / Float32Array.BYTES_PER_ELEMENT);
    xa.HEAPF32.set(inputMesh.normals, meshInfo.normalOffset / Float32Array.BYTES_PER_ELEMENT);
  
    xa.addMesh();
    xa.generateAtlas();
  
    const meshData = xa.getMeshData(meshInfo.meshId);
    const oldPositionArray = inputMesh.positions;
    const oldNormalArray = inputMesh.normals;

    const newPositionArray = new Float32Array(meshData.newVertexCount * 3);
    const newNormalArray = new Float32Array(meshData.newVertexCount * 3);
    const newUvArray = new Float32Array(xa.HEAPF32.buffer,meshData.uvOffset,meshData.newVertexCount * 2).slice();
    const newIndexArray = new Uint32Array(xa.HEAPU32.buffer,meshData.indexOffset,meshData.newIndexCount).slice();
    const originalIndexArray = new Uint32Array(xa.HEAPU32.buffer,meshData.originalIndexOffset,meshData.newVertexCount).slice();

    for (let i = 0; i < meshData.newVertexCount; i++) {
      const originalIndex = originalIndexArray[i];
      newPositionArray[i * 3] = oldPositionArray[originalIndex * 3];
      newPositionArray[i * 3 + 1] = oldPositionArray[originalIndex * 3 + 1];
      newPositionArray[i * 3 + 2] = oldPositionArray[originalIndex * 3 + 2];
      newNormalArray[i * 3] = oldNormalArray[originalIndex * 3];
      newNormalArray[i * 3 + 1] = oldNormalArray[originalIndex * 3 + 1];
      newNormalArray[i * 3 + 2] = oldNormalArray[originalIndex * 3 + 2];
    }
  
    xa.destroyAtlas();
  
    return {
      positions: newPositionArray,
      normals: newNormalArray,
      uvs: newUvArray,
      indices: newIndexArray,
      originalVertices: originalIndexArray,
    };
  }

  static _applyUVsToMeshData(meshData, output, triangleFaceMap) {
    const { uvs, indices } = output;
 
    meshData.uvs.clear();
 
    for (const face of meshData.faces.values()) {
      meshData.uvs.set(face.id, new Array(face.vertexIds.length).fill(null));
    }
 
    for (let triIdx = 0; triIdx < triangleFaceMap.length; triIdx++) {
      const { faceId, slots } = triangleFaceMap[triIdx];
      const faceUVs = meshData.uvs.get(faceId);
      if (!faceUVs) continue;
 
      for (let k = 0; k < 3; k++) {
        const slot      = slots[k];
        const outBufIdx = indices[triIdx * 3 + k];
 
        faceUVs[slot] = {
          u: uvs[outBufIdx * 2],
          v: uvs[outBufIdx * 2 + 1],
        };
      }
    }
 
    // Fill any remaining nulls
    for (const faceUVs of meshData.uvs.values()) {
      for (let i = 0; i < faceUVs.length; i++) {
        if (faceUVs[i] === null) faceUVs[i] = { u: 0, v: 0 };
      }
    }
  }

  static _buildOutputGeometry(output) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(output.positions, 3));
    geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(output.normals,   3));
    geometry.setAttribute('uv',       new THREE.Float32BufferAttribute(output.uvs,       2));
    geometry.setIndex(new THREE.BufferAttribute(output.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  static applyUVGridMaterial(object) {
    const loader = new THREE.TextureLoader();
    const gridTexture = loader.load('https://threejs.org/examples/textures/uv_grid_opengl.jpg');
    gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;

    const gridMaterial = new THREE.MeshPhongMaterial({ map: gridTexture });

    if (object.material.dispose) object.material.dispose();
    object.material = gridMaterial;
  }
}