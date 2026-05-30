import * as THREE from 'three';
import { auth } from '/supabase/services/AuthService.js';
import { SUPABASE_URL } from '/supabase/supabase.js';
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { computePerVertexNormals, computeFaceNormals, computeVertexNormalsWithAngle } from '../geometry/NormalCalculator.js';
import { consumeCredits, getCreditsErrorMessage } from '/supabase/services/CreditsService.js';

export class Exporter {
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
      const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
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
      const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
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
    let result = '';
    const format = (n) => Number(n).toFixed(6);

    let globalVertexIndex = 1;
    let globalNormalIndex = 1;
    let globalUVIndex = 1;

    for (const object of objects) {
      result += `\no ${object.name || object.uuid}\n`;

      const meshData = object.userData.meshData;
      const shading = object.userData.shading;

      const vertexIdToObjIndex = new Map();
      const normalIndexMap = new Map();
      
      object.updateWorldMatrix(true, false);
      const normalMatrix = new THREE.Matrix3().setFromMatrix4(object.matrixWorld).invert().transpose();

      // Write vertex positions
      for (let v of meshData.vertices.values()) {
        const pos = new THREE.Vector3(v.position.x, v.position.y, v.position.z)
    .applyMatrix4(object.matrixWorld);
        result += `v ${format(pos.x)} ${format(pos.y)} ${format(pos.z)}\n`;
        vertexIdToObjIndex.set(v.id, globalVertexIndex++);
      }

      // Write UVs
      const hasUVs = meshData.uvs && meshData.uvs.size > 0;
      const uvKeyToObjIndex = new Map();
      if (hasUVs) {
        for (const [faceId, faceUVs] of meshData.uvs) {
          for (let slot = 0; slot < faceUVs.length; slot++) {
            const uv = faceUVs[slot];
            result += `vt ${format(uv.u)} ${format(uv.v)}\n`;
            uvKeyToObjIndex.set(`${faceId}_${slot}`, globalUVIndex++);
          }
        }
      }

      // Compute normals depending on shading mode
      if (shading === "smooth") {
        const vertNormals = computePerVertexNormals(meshData);

        for (const [vid, n] of vertNormals) {
          const normal = n.clone().applyMatrix3(normalMatrix).normalize();
          result += `vn ${format(normal.x)} ${format(normal.y)} ${format(normal.z)}\n`;
          normalIndexMap.set(vid, globalNormalIndex++);
        }
      } else if (shading === "flat") {
        const faceNormals = computeFaceNormals(meshData);

        for (let [fid, n] of faceNormals) {
          const normal = n.clone().applyMatrix3(normalMatrix).normalize();
          result += `vn ${format(normal.x)} ${format(normal.y)} ${format(normal.z)}\n`;
          normalIndexMap.set(fid, globalNormalIndex++);
        }
      } else if (shading === "auto") {
        const fvNormals = computeVertexNormalsWithAngle(meshData, 45);

        for (const [key, n] of fvNormals) {
          const normal = n.clone().applyMatrix3(normalMatrix).normalize();
          result += `vn ${format(normal.x)} ${format(normal.y)} ${format(normal.z)}\n`;
          normalIndexMap.set(key, globalNormalIndex++);
        }
      }

      // Add smoothing group flag
      if (shading === "smooth" || shading === "auto") {
        result += "s 1\n";
      } else if (shading === "flat") {
        result += "s off\n";
      } 

      // Write faces
      for (let f of meshData.faces.values()) { 
        let faceLine = "f";

        for (let slot = 0; slot < f.vertexIds.length; slot++) {
          const vId = f.vertexIds[slot];
          const vIdx = vertexIdToObjIndex.get(vId);

          let nIdx;
          if (shading === "smooth") nIdx = normalIndexMap.get(vId);
          else if (shading === "flat") nIdx = normalIndexMap.get(f.id);
          else if (shading === "auto") nIdx = normalIndexMap.get(`${f.id}_${vId}`);

          const uvIdx = hasUVs ? uvKeyToObjIndex.get(`${f.id}_${slot}`) : null;

          if (uvIdx != null) {
            faceLine += ` ${vIdx}/${uvIdx}/${nIdx}`;
          } else {
            faceLine += ` ${vIdx}//${nIdx}`;
          }
        }

        result += faceLine + "\n";
      }
    }

    this.saveFile(result, `object.obj`, 'text/plain');
    console.log('Exported OBJ with multiple objects:', objects.map(o => o.name).join(', '));
  }

  async exportStl(objects) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();

    const group = new THREE.Group();

    objects.forEach(object => {
      const meshData = object.userData.meshData;
      const shading = object.userData.shading;
      const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
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
      const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
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
      const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
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