import * as THREE from 'three';
import { ShadingUtils } from "../utils/ShadingUtils.js";

export class ObjectEditor {
  constructor(editor) {
    this.editor = editor;
    this.meshEditor = editor.meshEditor;
    this.sceneManager = editor.sceneManager;
  }

  duplicateObject(object) {
    const clone = object.clone(true);

    clone.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) {
          child.geometry = child.geometry.clone();
        }

        if (child.material) {
          child.material = Array.isArray(child.material)
            ? child.material.map(m => m.clone()) : child.material.clone();
        }
      }
    });

    return clone;
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