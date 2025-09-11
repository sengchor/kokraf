import * as THREE from 'three';
import { ShadingUtils } from "../utils/ShadingUtils.js";

export class Exporter {
  constructor(editor) {
    this.editor = editor;
  }

  async export(object, format) {
    const handlers = {
      'glb': () => this.exportGlb(object),
      'gltf': () => this.exportGltf(object),
      'obj': () => this.exportObj(object),
      'stl': () => this.exportStl(object),
      'stl-binary': () => this.exportStlBinary(object),
      'usdz': () => this.exportUsdz(object),
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

  saveFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async exportGlb(object) {
    const { GLTFExporter } = await import('jsm/exporters/GLTFExporter.js');

    const exporter = new GLTFExporter();

    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;

    const result = await new Promise((resolve, reject) => {
      exporter.parse(mesh, resolve, reject, { binary: true });
    });

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    this.saveFile(blob, `${object.name || 'object'}.glb`, 'model/gltf-binary');
    console.log('Exported GLB:', object.name || object.uuid);
  }

  async exportGltf(object) {
    const { GLTFExporter } = await import('jsm/exporters/GLTFExporter.js');

    const exporter = new GLTFExporter();

    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;

    const result = await new Promise((resolve, reject) => {
      exporter.parse(mesh, resolve, reject, { binary: false });
    });

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
    this.saveFile(blob, `${object.name || 'object'}.gltf`, 'model/gltf+json');
    console.log('Exported GLTF:', object.name || object.uuid);
  }

  async exportObj(object) {
    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    let result = '';

    const format = (n) => Number(n).toFixed(6);
    const vertexIdToObjIndex = new Map();
    const normalIndexMap = new Map();
    
    let index = 1;
    let normalIndex = 1;

    // Write vertex positions
    for (let v of meshData.vertices.values()) {
      result += `v ${format(v.position.x)} ${format(v.position.y)} ${format(v.position.z)}\n`;
      vertexIdToObjIndex.set(v.id, index++);
    }

    // Compute normals depending on shading mode
    if (shading === "smooth") {
      const vertNormals = meshData.computePerVertexNormals();

      for (const [vid, n] of vertNormals) {
        result += `vn ${format(n.x)} ${format(n.y)} ${format(n.z)}\n`;
        normalIndexMap.set(vid, normalIndex++);
      }
    } else if (shading === "flat") {
      const faceNormals = meshData.computeFaceNormals();

      for (let [fid, n] of faceNormals) {
        result += `vn ${format(n.x)} ${format(n.y)} ${format(n.z)}\n`;
        normalIndexMap.set(fid, normalIndex++);
      }
    } else if (shading === "auto") {
      const fvNormals = meshData.computeVertexNormalsWithAngle();

      for (const [key, n] of fvNormals) {
        result += `vn ${format(n.x)} ${format(n.y)} ${format(n.z)}\n`;
        normalIndexMap.set(key, normalIndex++);
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

      if (shading === "smooth") {
        for (let vId of f.vertexIds) {
          const vIdx = vertexIdToObjIndex.get(vId);
          const nIdx = normalIndexMap.get(vId);
          faceLine += ` ${vIdx}//${nIdx}`;
        }
      } else if (shading === "flat") {
        const nIdx = normalIndexMap.get(f.id);
        for (let vId of f.vertexIds) {
          const vIdx = vertexIdToObjIndex.get(vId);
          faceLine += ` ${vIdx}//${nIdx}`;
        }
      } else if (shading === "auto") {
        for (let vId of f.vertexIds) {
          const vIdx = vertexIdToObjIndex.get(vId);
          const nIdx = normalIndexMap.get(`${f.id}_${vId}`);
          faceLine += ` ${vIdx}//${nIdx}`;
        }
      }

      result += faceLine + "\n";
    }

    this.saveFile(result, `${object.name || 'object'}.obj`, 'text/plain');
    console.log('Exported OBJ:', object.name || object.uuid);
  }

  async exportStl(object) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();

    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;

    const result = exporter.parse(mesh);

    this.saveFile(result, `${object.name || 'object'}.stl`, 'text/plain');
    console.log('Exported STL:', object.name || object.uuid);
  }

  async exportStlBinary(object) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();

    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;

    const result = exporter.parse(mesh, { binary: true });

    this.saveFile(result, `${object.name || 'object'}.stl`, 'application/octet-stream');
    console.log('Exported Binary STL:', object.name || object.uuid);
  }

  async exportUsdz(object) {
    const { USDZExporter } = await import('jsm/exporters/USDZExporter.js');

    const exporter = new USDZExporter();

    const meshData = object.userData.meshData;
    const shading = object.userData.shading;
    const geometry = ShadingUtils.createGeometryWithShading(meshData, shading);
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;

    const result = await exporter.parseAsync(mesh);

    this.saveFile(result, `${object.name || 'object'}.usdz`, 'model/vnd.usdz+zip');
    console.log('Exported USDZ:', object.name || object.uuid);
  }
}