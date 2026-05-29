import * as THREE from 'three';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { ShadingUtils } from "../utils/ShadingUtils.js";
import OBJLoader from './OBJLoader.js';
import GLBLoader from './GLBLoader.js';

export class Loader {
  constructor(editor) {
    this.editor = editor;
  }

  async load(file, siblingFiles = []) {
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.addEventListener('progress', (event) => {
      const size = '(' + parseFloat(Math.floor(event.total / 1000).toFixed(3)) + ' KB)';
      const progress = Math.floor((event.loaded / event.total) * 100) + '%';
      console.log('Loading', file.name, size, progress);
    });

    const handlers = {
			'obj': () => this.loadObj(file, reader),
      'glb': () => this.loadGLB(file, siblingFiles),
      'gltf': () => this.loadGLB(file, siblingFiles)
    };

    if (handlers[extension]) {
      handlers[extension]();
    } else {
      const supported = Object.keys(handlers)
        .map(ext => `.${ext}`).join(', ');
      alert(`Unsupported file format: .${extension}. Supported formats: ${supported}`);
    }
  }

  async loadObj(file, reader) {
    reader.addEventListener('load', (event) => {
      const text = event.target.result;
      const meshObjects = OBJLoader.fromOBJText(text);
      const shadingObjects = ShadingUtils.getShadingFromOBJ(text);

      const reservedNames = new Set();
      const meshes = meshObjects.map(({ name, meshData }, i) => {
        const shading = shadingObjects[i] || 'flat';
        const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);

        const material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          metalness: 0.5,
          roughness: 0.2,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        const baseName = this.editor.nameManager.getBaseName(name || file.name);
        const uniqueName = this.editor.nameManager.generateUniqueNameWithReserved(baseName, reservedNames);
        mesh.name = uniqueName;
        reservedNames.add(uniqueName);

        mesh.userData.meshData = meshData;
        mesh.userData.shading = shading;
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

        finalObject.name = this.editor.nameManager.generateUniqueNameWithReserved(
          file.name.replace(/\.[^.]+$/, ''),
          reservedNames
        );
      }

      this.editor.execute(new AddObjectCommand(this.editor, finalObject));
    });

    reader.readAsText(file);
  }

  async loadGLB(file, siblingFiles = []) {
    const arrayBuffer = await file.arrayBuffer();
    const meshObjects = await GLBLoader.fromArrayBuffer(arrayBuffer, siblingFiles);
    const reservedNames = new Set();

    const meshes = meshObjects.map(({ name, meshData }) => {
      const geometry = ShadingUtils.createGeometryWithShading(meshData, 'auto');

      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.5,
        roughness: 0.2,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geometry, material);
      const baseName = this.editor.nameManager.getBaseName(name || file.name);
      const uniqueName = this.editor.nameManager.generateUniqueNameWithReserved(baseName, reservedNames);
      mesh.name = uniqueName;
      reservedNames.add(uniqueName);

      mesh.userData.meshData = meshData;
      mesh.userData.shading = 'auto';
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

      finalObject.name = this.editor.nameManager.generateUniqueNameWithReserved(
        file.name.replace(/\.[^.]+$/, ''),
        reservedNames
      );
    }

    this.editor.execute(new AddObjectCommand(this.editor, finalObject));
  }
}
