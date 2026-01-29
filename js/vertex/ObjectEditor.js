import * as THREE from 'three';
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { MeshData } from '../core/MeshData.js';

export class ObjectEditor {
  constructor(editor) {
    this.editor = editor;
    this.meshEditor = editor.meshEditor;
    this.sceneManager = editor.sceneManager;
  }

  duplicateObjects(objects) {
    const clones = [];

    for (const object of objects) {
      if (!object) continue;

      const clone = object.clone(false);

      if (clone.isMesh) {
        if (clone.geometry) {
          clone.geometry = clone.geometry.clone();
        }

        if (clone.material) {
          clone.material = Array.isArray(clone.material)
            ? clone.material.map(m => m.clone())
            : clone.material.clone();
        }
      }

      clone.userData = { ...object.userData };

      const objectMeshData = object.userData.meshData;
      if (objectMeshData) {
        if (!(objectMeshData instanceof MeshData)) {
          MeshData.rehydrateMeshData(object);
        }

        clone.userData.meshData = JSON.parse(
          JSON.stringify(object.userData.meshData.toJSON())
        );
      }

      clones.push(clone);
    }

    return clones;
  }

  joinObjects(objects) {
    if (!objects || objects.length === 0) return null;

    const meshDatas = [];
    const transforms = [];

    const baseObject = objects[objects.length - 1];
    const baseMaterial = baseObject.material;
    const baseShading = baseObject.userData.shading;

    for (const object of objects) {
      if (!object.isMesh || !object.userData.meshData) return null;

      if (object.userData.meshData && !(object.userData.meshData instanceof MeshData)) {
        MeshData.rehydrateMeshData(object);
      }

      meshDatas.push(object.userData.meshData);
      transforms.push(object.matrixWorld);
    }

    if (meshDatas.length === 0) return null;

    const inverseBaseWorld = baseObject.matrixWorld.clone().invert();
    const mergedMeshData = this.meshEditor.mergeMeshData(meshDatas, transforms, inverseBaseWorld);

    const geometry = ShadingUtils.createGeometryWithShading(mergedMeshData, baseShading);

    const material = Array.isArray(baseMaterial) ? baseMaterial.map(m => m.clone()) : baseMaterial.clone();

    const mesh = new THREE.Mesh(geometry, material);

    mesh.userData.meshData = mergedMeshData;
    mesh.userData.shading = baseShading;
    mesh.name = baseObject.name;

    return mesh;
  }
}