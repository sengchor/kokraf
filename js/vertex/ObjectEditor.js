import * as THREE from 'three';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';
import { MeshData } from '../core/MeshData.js';
import { SeamUtils } from '../utils/SeamUtils.js';
import { SharpUtils } from '../utils/SharpUtils.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';

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

      if (clone.isMesh && clone.material) {
        clone.material = Array.isArray(clone.material)
          ? clone.material.map(m => m.clone())
          : clone.material.clone();
      }

      clone.userData = { ...object.userData };

      clone.userData.seam = new Set(object.userData.seam ?? []);
      clone.userData.sharp = new Set(object.userData.sharp ?? []);
      if (object.userData.mirror) clone.userData.mirror = structuredClone(object.userData.mirror);

      const objectMeshData = object.userData.meshData;
      if (objectMeshData) {
        if (!(objectMeshData instanceof MeshData)) {
          MeshData.rehydrateMeshData(object);
        }

        clone.userData.meshData = JSON.parse(
          JSON.stringify(object.userData.meshData.toJSON())
        );
        MeshData.rehydrateMeshData(clone);

        const { mode, angle } = ShadingUtils.getShading(object);
        const sharps = clone.userData.sharp;
        clone.userData.shading = mode;
        clone.userData.shadingAngle = angle;

        const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(clone.userData.meshData, {
          mode, angle, sharps,
        });
        clone.geometry = geometry;
        clone.userData.renderBuffer = renderBuffer;
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
    const { mode, angle } = ShadingUtils.getShading(baseObject);

    for (const object of objects) {
      if (!object.isMesh || !object.userData.meshData) return null;

      if (!(object.userData.meshData instanceof MeshData)) {
        MeshData.rehydrateMeshData(object);
      }

      object.updateMatrixWorld(true, false);

      meshDatas.push(object.userData.meshData);
      transforms.push(object.matrixWorld.clone());
    }

    if (meshDatas.length === 0) return null;

    const inverseBaseWorld = baseObject.matrixWorld.clone().invert();
    const { merged: mergedMeshData, maps } = this.meshEditor.mergeMeshData(meshDatas, transforms, inverseBaseWorld);

    const seams = SeamUtils.mergeSeams(objects, maps);
    const sharps = SharpUtils.mergeSharps(objects, maps);

    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(mergedMeshData, {
      mode, angle, sharps,
    });

    const material = Array.isArray(baseMaterial) ? baseMaterial.map(m => m.clone()) : baseMaterial.clone();

    const mesh = new THREE.Mesh(geometry, material);

    mesh.userData.meshData = mergedMeshData;
    mesh.userData.renderBuffer = renderBuffer;
    mesh.userData.shading = mode;
    mesh.userData.shadingAngle = angle;
    mesh.userData.seam = seams;
    mesh.userData.sharp = sharps;
    mesh.name = baseObject.name;

    return mesh;
  }

  cloneObjectFromMeshData(meshData, object, { seam = null, sharp = null } = {}) {
    if (!meshData || !object) return null;

    if (!(meshData instanceof MeshData)) {
      meshData = MeshData.getRehydratedMeshData(meshData);
    }

    const { mode, angle } = ShadingUtils.getShading(object);
    const material = object.material;

    const seams = new Set(seam ?? []);
    const sharps = new Set(sharp ?? []);

    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(meshData, {
      mode, angle, sharps,
    });

    const clonedMaterial = Array.isArray(material) ? material.map(m => m.clone()) : material.clone();

    const mesh = new THREE.Mesh(geometry, clonedMaterial);

    mesh.position.copy(object.position);
    mesh.quaternion.copy(object.quaternion);
    mesh.scale.copy(object.scale);
    mesh.updateMatrixWorld(true);

    mesh.userData.meshData = meshData;
    mesh.userData.renderBuffer = renderBuffer;
    mesh.userData.shading = mode;
    mesh.userData.shadingAngle = angle;
    mesh.userData.seam = seams;
    mesh.userData.sharp = sharps;

    const baseName = this.editor.nameManager.getBaseName(object.name);
    mesh.name = this.editor.nameManager.generateUniqueName(baseName);

    return mesh;
  }
}