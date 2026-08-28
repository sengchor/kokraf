import * as THREE from 'three';
import { auth } from '/supabase/services/AuthService.js';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';
import { consumeCredits, getCreditsErrorMessage } from '/supabase/services/CreditsService.js';
import { buildObj } from './ObjExporter.js'

export class MeshExporter {
  constructor(editor) {
    this.editor = editor;
  }

  async export(objects, format) {
    // Check if user is logged in
    if (!auth.isLoggedIn()) {
      this.editor.signals.showLoginPanel.dispatch();
      return;
    }

    const canExport = await this.canExport();
    if (!canExport) return;

    const meshObjects = objects.filter(obj => obj && obj.isMesh);
    if (meshObjects.length === 0) {
      alert("No valid meshes found to export.");
      return;
    }

    const handlers = {
      'glb': () => this.exportGlb(meshObjects),
      'gltf': () => this.exportGltf(meshObjects),
      'obj': () => this.exportObj(meshObjects),
      'stl': () => this.exportStl(meshObjects),
      'stl-binary': () => this.exportStlBinary(meshObjects),
      'usdz': () => this.exportUsdz(meshObjects),
    };

    const handler = handlers[format.toLowerCase()];

    if (handler) {
      try {
        await handler();
      } catch (error) {
        console.error(`Export failed (${format.toUpperCase()}):`, error);
        alert(`Failed to export object as ${format.toUpperCase()}.`);
      }
    } else {
      alert(`Unsupported export format: ${format}`);
    }
  }

  async canExport() {
    const { allowed, reason } = await consumeCredits('export');
    if (!allowed) {
      alert(getCreditsErrorMessage(reason));
    }
    return allowed;
  }

  saveFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async exportGlb(objects) {
    const { GLTFExporter } = await import('jsm/exporters/GLTFExporter.js');

    const exporter = new GLTFExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const { geometry } = MeshRendererAdapter.toBufferGeometry(meshData, { mode: shading });
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;

      object.updateWorldMatrix(true, false);
      mesh.applyMatrix4(object.matrixWorld);

      group.add(mesh);
    });

    const result = await new Promise((resolve, reject) => {
      exporter.parse(group, resolve, reject, { binary: true });
    });

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    this.saveFile(blob, `object.glb`, 'model/gltf-binary');
    console.log('Exported GLB with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportGltf(objects) {
    const { GLTFExporter } = await import('jsm/exporters/GLTFExporter.js');

    const exporter = new GLTFExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const { geometry } = MeshRendererAdapter.toBufferGeometry(meshData, { mode: shading });
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;

      object.updateWorldMatrix(true, false);
      mesh.applyMatrix4(object.matrixWorld);

      group.add(mesh);
    });


    const result = await new Promise((resolve, reject) => {
      exporter.parse(group, resolve, reject, { binary: false });
    });

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
    this.saveFile(blob, `object.gltf`, 'model/gltf+json');
    console.log('Exported GLTF with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportObj(objects) {
    this.saveFile(buildObj(objects), `object.obj`, 'text/plain');
    console.log('Exported OBJ with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportStl(objects) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const { geometry } = MeshRendererAdapter.toBufferGeometry(meshData, { mode: shading });
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;

      object.updateWorldMatrix(true, false);
      mesh.geometry.applyMatrix4(object.matrixWorld);

      group.add(mesh);
    });

    const result = exporter.parse(group);

    this.saveFile(result, `object.stl`, 'text/plain');
    console.log('Exported STL with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportStlBinary(objects) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const { geometry } = MeshRendererAdapter.toBufferGeometry(meshData, { mode: shading });
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;

      object.updateWorldMatrix(true, false);
      mesh.geometry.applyMatrix4(object.matrixWorld);

      group.add(mesh);
    });

    const result = exporter.parse(group, { binary: true });

    this.saveFile(result, `object.stl`, 'application/octet-stream');
    console.log('Exported Binary STL with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportUsdz(objects) {
    const { USDZExporter } = await import('jsm/exporters/USDZExporter.js');

    const exporter = new USDZExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const { geometry } = MeshRendererAdapter.toBufferGeometry(meshData, { mode: shading });
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;

      object.updateWorldMatrix(true, false);
      mesh.geometry.applyMatrix4(object.matrixWorld);

      group.add(mesh);
    });

    const result = await exporter.parseAsync(group);

    this.saveFile(result, `object.usdz`, 'model/vnd.usdz+zip');
    console.log('Exported USDZ with multiple objects:', objects.map(o => o.name).join(', '));
  }
}