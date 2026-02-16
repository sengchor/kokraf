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
    const reservedNames = new Set();

    for (const object of objects) {
      if (!object) continue;

      const clone = object.clone(false);
      clone.children.length = 0;

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
        MeshData.rehydrateMeshData(clone);
      }
      
      const baseName = this.editor.nameManager.getBaseName(object.name);
      const uniqueName = this.editor.nameManager.generateUniqueNameWithReserved(baseName, reservedNames);
      clone.name = uniqueName;
      reservedNames.add(uniqueName);

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

  cloneObjectFromMeshData(meshData, object) {
    if (!meshData || !object) return null;

    if (!(meshData instanceof MeshData)) {
      meshData = MeshData.getRehydratedMeshData(meshData);
    }

    const shading = object.userData.shading;
    const material = object.material;

    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);

    const clonedMaterial = Array.isArray(material) ? material.map(m => m.clone()) : material.clone();

    const mesh = new THREE.Mesh(geometry, clonedMaterial);

    mesh.position.copy(object.position);
    mesh.quaternion.copy(object.quaternion);
    mesh.scale.copy(object.scale);
    mesh.updateMatrixWorld(true);

    mesh.userData.meshData = meshData;
    mesh.userData.shading = shading;

    const baseName = this.editor.nameManager.getBaseName(object.name);
    mesh.name = this.editor.nameManager.generateUniqueName(baseName);

    return mesh;
  }
}