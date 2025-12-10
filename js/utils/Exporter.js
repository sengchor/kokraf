import * as THREE from 'three';
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { computePerVertexNormals, computeFaceNormals, computeVertexNormalsWithAngle } from '../geometry/NormalCalculator.js';

export class Exporter {
  constructor(editor) {
    this.editor = editor;
  }

  async export(objects, format) {
    const handlers = {
      'glb': () => this.exportGlb(objects),
      'gltf': () => this.exportGltf(objects),
      'obj': () => this.exportObj(objects),
      'stl': () => this.exportStl(objects),
      'stl-binary': () => this.exportStlBinary(objects),
      'usdz': () => this.exportUsdz(objects),
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