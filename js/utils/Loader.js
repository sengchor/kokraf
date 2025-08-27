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
          const { geometry, vertexIndexMap } = meshData.toBufferGeometry();
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
    reader.addEventListener('load', async (event) => {
      const { OBJLoader } = await import('jsm/loaders/OBJLoader.js');

      const object = new OBJLoader().parse(event.target.result);
      object.name = file.name;
      this.editor.execute(new AddObjectCommand(this.editor, object));
    });
    reader.readAsText(file);
  }
}
