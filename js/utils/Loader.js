import * as THREE from 'three';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { MeshData } from '../core/MeshData.js';

export class Loader {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.manager = new THREE.LoadingManager();
  }

  async load(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.addEventListener('progress', (event) => {
      const size = '(' + parseFloat(Math.floor(event.total / 1000).toFixed(3)) + ' KB)';
      const progress = Math.floor((event.loaded / event.total) * 100) + '%';
      console.log('Loading', file.name, size, progress);
    });

    const handlers = {
			'fbx': () => this.loadFbx(file, reader),
			'obj': () => this.loadObj(file, reader),
    };

    if (handlers[extension]) {
      handlers[extension]();
    } else {
      alert(`Unsupported file format: .${extension}`);
    }
  }

  applyTransformToGeometry(mesh) {
    const scaleMatrix = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
    mesh.updateMatrixWorld(true);

    const finalMatrix = new THREE.Matrix4().multiplyMatrices(scaleMatrix, mesh.matrixWorld);
    mesh.geometry.applyMatrix4(finalMatrix);

    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
  }

  async loadFbx(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { FBXLoader } = await import('jsm/loaders/FBXLoader.js');

      const loader = new FBXLoader(this.manager);
      const object = loader.parse(contents);
      object.name = file.name;

      const meshes = [];
      object.traverse((child) => {
        if (child.isMesh) {
          this.applyTransformToGeometry(child);

          const meshData = MeshData.fromFBXGeometry(child.geometry);
          const { geometry, vertexIndexMap } = meshData.toDuplicatedVertexGeometry();
          child.geometry.dispose();
          child.geometry = geometry;

          child.userData.meshData = meshData;
          child.userData.vertexIndexMap = vertexIndexMap;
          
          child.geometry.computeBoundingSphere();
          child.geometry.computeBoundingBox();
          meshes.push(child);
        }
      });

      let finalObject;
      if (meshes.length === 1) {
        finalObject = meshes[0];
      } else if (meshes.length > 1) {
        const container = new THREE.Group();
        meshes.forEach(mesh => container.add(mesh));
        finalObject = container;
      } else {
        console.warn("No mesh found in FBX:", file.name);
        return;
      }

      this.editor.execute(new AddObjectCommand(this.editor, finalObject));
    });

    reader.readAsArrayBuffer(file);
  }

  async loadObj(file, reader) {
    reader.addEventListener('load', (event) => {
      const text = event.target.result;
      const meshObjects = MeshData.fromOBJText(text);

      const meshes = meshObjects.map(({ name, meshData }) => {
        const { geometry, vertexIndexMap } = meshData.toDuplicatedVertexGeometry();
        const material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          metalness: 0.5,
          roughness: 0.2,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name || file.name;
        mesh.userData.meshData = meshData;
        mesh.userData.vertexIndexMap = vertexIndexMap;
        mesh.geometry.computeBoundingSphere();
        mesh.geometry.computeBoundingBox();
        return mesh;
      });

      let finalObject;
      if (meshes.length === 1) {
        finalObject = meshes[0];
      } else {
        finalObject = new THREE.Group();
        meshes.forEach(m => finalObject.add(m));
      }

      this.editor.execute(new AddObjectCommand(this.editor, finalObject));
    });

    reader.readAsText(file);
  }
}
