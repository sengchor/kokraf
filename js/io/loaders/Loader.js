import * as THREE from 'three';
import { AddObjectCommand } from "../../commands/AddObjectCommand.js";
import { MeshRendererAdapter } from '../../geometry/MeshRendererAdapter.js';
import { ShadingUtils } from '../../utils/ShadingUtils.js';
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
      const meshObjects = OBJLoader.fromOBJText(event.target.result);
      this.addImported(file, meshObjects);
    });

    reader.readAsText(file);
  }

  async loadGLB(file, siblingFiles = []) {
    const arrayBuffer = await file.arrayBuffer();
    const meshObjects = await GLBLoader.fromArrayBuffer(arrayBuffer, siblingFiles);
    this.addImported(file, meshObjects);
  }

  // Shared by all format loaders: [{ name, meshData, shading, angle, sharps }] -> scene
  addImported(file, meshObjects) {
    if (meshObjects.length === 0) {
      alert(`No meshes found in ${file.name}.`);
      return;
    }

    const reservedNames = new Set();
    const meshes = meshObjects.map(imported => this.createMesh(imported, file, reservedNames));

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

  createMesh({ name, meshData, shading, angle, sharps }, file, reservedNames) {
    const sharp = new Set(sharps ?? []);
    const { mode, angle: shadingAngle } = ShadingUtils.normalize({ mode: shading, angle });

    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(meshData, {
      mode, angle: shadingAngle, sharps: sharp
    });

    const material = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.2,
      roughness: 0.2,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    const baseName = this.editor.nameManager.getBaseName(name || file.name);
    const uniqueName = this.editor.nameManager.generateUniqueNameWithReserved(baseName, reservedNames);
    mesh.name = uniqueName;
    reservedNames.add(uniqueName);

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.meshData = meshData;
    mesh.userData.renderBuffer = renderBuffer;
    mesh.userData.shading = mode;
    mesh.userData.shadingAngle = shadingAngle;
    mesh.userData.sharp = sharp;
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    return mesh;
  }
}