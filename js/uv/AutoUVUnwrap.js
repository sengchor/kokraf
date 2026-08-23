import * as THREE from 'three';
import earcut from 'earcut';
import KokrafXAtlas from '/wasm/xatlas.js';
import { computePlaneNormal, projectTo2D } from '../geometry/TriangulationUtils.js';

let _xatlasModule = null;

async function getXAtlasModule() {
  if (_xatlasModule) return _xatlasModule;
  _xatlasModule = await KokrafXAtlas();
  return _xatlasModule;
}

export class AutoUVUnwrap {
  static async unwrap(meshData) {
    const inputMesh = this._buildInputMesh(meshData);
    const output = await this._runXAtlas(inputMesh);
    this._applyUVsToMeshData(meshData, output, inputMesh);
    return { output, inputMesh };
  }

  static _buildInputMesh(meshData) {
    console.log(meshData);
    const positions = [];
    const vertexToBufIdx = new Map();

    for (const [vId, vertex] of meshData.vertices) {
      vertexToBufIdx.set(vId, positions.length / 3);
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
    }

    const indices = [];
    const faceVertexCount = [];
    const faceOrder = [];
    const faceSlotMaps = [];

    for (const face of meshData.faces.values()) {
      const vIds = face.vertexIds;
      const slotMap = new Map();

      vIds.forEach((vId, slot) => {
        const bufIdx = vertexToBufIdx.get(vId);
        indices.push(bufIdx);
        slotMap.set(bufIdx, slot);
      });

      faceVertexCount.push(vIds.length);
      faceOrder.push(face);
      faceSlotMaps.push(slotMap);
    }

    const normalIndices = [];
    for (const face of meshData.faces.values()) {
      const vIds = face.vertexIds;
      const verts = vIds.map(id => meshData.vertices.get(id));
      const normal = computePlaneNormal(verts);
      const flat2D = projectTo2D(verts, normal);
      const localTris = earcut(flat2D);
      for (let i = 0; i < localTris.length; i += 3) {
        normalIndices.push(
          vertexToBufIdx.get(vIds[localTris[i]]),
          vertexToBufIdx.get(vIds[localTris[i + 1]]),
          vertexToBufIdx.get(vIds[localTris[i + 2]]),
        );
      }
    }

    const tmpGeo = new THREE.BufferGeometry();
    tmpGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tmpGeo.setIndex(normalIndices);
    tmpGeo.computeVertexNormals();
    const normals = new Float32Array(tmpGeo.attributes.normal.array);
    tmpGeo.dispose();

    return {
      positions: new Float32Array(positions),
      normals,
      indices: new Uint32Array(indices),
      faceVertexCount: new Uint32Array(faceVertexCount),
      faceOrder,
      faceSlotMaps,
    };
  }

  static async _runXAtlas(inputMesh) {
    const xa = await getXAtlasModule();
    const atlas = new xa.Atlas();

    try {
      const addResult = atlas.addMesh({
        positions: inputMesh.positions,
        normals: inputMesh.normals,
        indices: inputMesh.indices,
        faceVertexCount: inputMesh.faceVertexCount,
      });

      if (addResult !== 0) {
        throw new Error(`xatlas addMesh failed, AddMeshError=${addResult}`);
      }

      atlas.generate({}, {});

      const mesh = atlas.getMesh(0);
      const atlasInfo = atlas.getAtlasInfo();
      const width = atlasInfo.width || 1;
      const height = atlasInfo.height || 1;

      const rawUvs = mesh.uvs;
      const uvs = new Float32Array(rawUvs.length);
      for (let i = 0; i < mesh.vertexCount; i++) {
        uvs[i * 2]     = rawUvs[i * 2] / width;
        uvs[i * 2 + 1] = rawUvs[i * 2 + 1] / height;
      }

      const xref = mesh.xref;
      const positions = new Float32Array(mesh.vertexCount * 3);
      const normals = new Float32Array(mesh.vertexCount * 3);

      for (let i = 0; i < mesh.vertexCount; i++) {
        const orig = xref[i];
        positions.set(inputMesh.positions.subarray(orig * 3, orig * 3 + 3), i * 3);
        normals.set(inputMesh.normals.subarray(orig * 3, orig * 3 + 3), i * 3);
      }

      return {
        positions,
        normals,
        uvs,
        indices: mesh.indexArray,
        originalVertices: xref,
        chartIndex: mesh.chartIndex,
      };
    } finally {
      atlas.delete();
    }
  }

  static _applyUVsToMeshData(meshData, output, inputMesh) {
    const { uvs, indices, originalVertices: xref } = output;
    const { faceOrder, faceSlotMaps } = inputMesh;

    meshData.uvs.clear();
    for (const face of meshData.faces.values()) {
      meshData.uvs.set(face.id, new Array(face.vertexIds.length).fill(null));
    }

    let indexCursor = 0;

    for (let f = 0; f < faceOrder.length; f++) {
      const face = faceOrder[f];
      const slotMap = faceSlotMaps[f];
      const count = face.vertexIds.length;
      const faceUVs = meshData.uvs.get(face.id);

      for (let i = 0; i < count; i++) {
        const outVtx = indices[indexCursor + i];
        const bufIdx = xref[outVtx];
        const slot = slotMap.get(bufIdx);

        if (slot !== undefined) {
          faceUVs[slot] = { 
            u: uvs[outVtx * 2], 
            v: uvs[outVtx * 2 + 1] 
          };
        }
      }

      indexCursor += count;
    }

    // Fallback for unmapped slots
    for (const faceUVs of meshData.uvs.values()) {
      for (let i = 0; i < faceUVs.length; i++) {
        if (faceUVs[i] === null) faceUVs[i] = { u: 0, v: 0 };
      }
    }
  }

  static _buildOutputGeometry(output, inputMesh) {
    const { positions, normals, uvs, indices } = output;
    const faceVertexCount = inputMesh.faceVertexCount;

    const triIndices = [];
    const scratch = [];
    let cursor = 0;

    for (let f = 0; f < faceVertexCount.length; f++) {
      const count = faceVertexCount[f];

      if (count < 3) {
        cursor += count;
        continue;
      }

      const corner = indices.subarray(cursor, cursor + count);
      cursor += count;

      if (count === 3) {
        triIndices.push(corner[0], corner[1], corner[2]);
        continue;
      }

      scratch.length = 0;
      for (let i = 0; i < count; i++) {
        const o = corner[i] * 3;
        scratch.push({
          position: new THREE.Vector3(
            positions[o],
            positions[o + 1],
            positions[o + 2]
          )
        });
      }

      const normal = computePlaneNormal(scratch);
      const flat2D = projectTo2D(scratch, normal);
      const localTris = earcut(flat2D);

      if (localTris.length >= 3) {
        for (let i = 0; i < localTris.length; i += 3) {
          triIndices.push(
            corner[localTris[i]],
            corner[localTris[i + 1]],
            corner[localTris[i + 2]]
          );
        }
      } else {
        for (let i = 1; i < count - 1; i++) {
          triIndices.push(corner[0], corner[i], corner[i + 1]);
        }
      }
    }

    const vertexCount = positions.length / 3;
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geometry.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(triIndices), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  static applyUVGridMaterial(object) {
    const loader = new THREE.TextureLoader();
    const gridTexture = loader.load('https://threejs.org/examples/textures/uv_grid_opengl.jpg');
    gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;

    const gridMaterial = new THREE.MeshPhongMaterial({ map: gridTexture, side: THREE.DoubleSide });

    if (object.material.dispose) object.material.dispose();
    object.material = gridMaterial;
  }

  static hasUVs(meshData) {
    if (meshData.faces.size === 0 || meshData.uvs.size === 0) return false;

    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!faceUVs || faceUVs.length !== face.vertexIds.length) return false;

      for (const uv of faceUVs) {
        if (!uv || !Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return false;
      }
    }

    return true;
  }
}