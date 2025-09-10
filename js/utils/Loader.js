import * as THREE from 'three';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { MeshData } from '../core/MeshData.js';
import { ShadingUtils } from "../utils/ShadingUtils.js";

export class Loader {
  constructor(editor) {
    this.editor = editor;
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
			'obj': () => this.loadObj(file, reader),
    };

    if (handlers[extension]) {
      handlers[extension]();
    } else {
      alert(`Unsupported file format: .${extension}. Only .obj files are supported.`);
    }
  }

  async loadObj(file, reader) {
    reader.addEventListener('load', (event) => {
      const text = event.target.result;
      const meshObjects = MeshData.fromOBJText(text);
      const shadingObjects = ShadingUtils.getShadingFromOBJ(text);

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
        mesh.name = name || file.name;
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
      }

      this.editor.execute(new AddObjectCommand(this.editor, finalObject));
    });

    reader.readAsText(file);
  }
}
