import * as THREE from 'three';

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
    const result = await new Promise((resolve, reject) => {
      exporter.parse(object, resolve, reject, { binary: true });
    });

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    this.saveFile(blob, `${object.name || 'object'}.glb`, 'model/gltf-binary');
    console.log('Exported GLB:', object.name || object.uuid);
  }

  async exportGltf(object) {
    const { GLTFExporter } = await import('jsm/exporters/GLTFExporter.js');

    const exporter = new GLTFExporter();
    const result = await new Promise((resolve, reject) => {
      exporter.parse(object, resolve, reject, { binary: false });
    });

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
    this.saveFile(blob, `${object.name || 'object'}.gltf`, 'model/gltf+json');
    console.log('Exported GLTF:', object.name || object.uuid);
  }

  async exportObj(object) {
    const { OBJExporter } = await import('jsm/exporters/OBJExporter.js');

    const exporter = new OBJExporter();
    const result = exporter.parse(object);

    this.saveFile(result, `${object.name || 'object'}.obj`, 'text/plain');
    console.log('Exported OBJ:', object.name || object.uuid);
  }

  async exportStl(object) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();
    const result = exporter.parse(object);

    this.saveFile(result, `${object.name || 'object'}.stl`, 'text/plain');
    console.log('Exported STL:', object.name || object.uuid);
  }

  async exportStlBinary(object) {
    const { STLExporter } = await import('jsm/exporters/STLExporter.js');

    const exporter = new STLExporter();
    const result = exporter.parse(object, { binary: true });

    this.saveFile(result, `${object.name || 'object'}.stl`, 'application/octet-stream');
    console.log('Exported Binary STL:', object.name || object.uuid);
  }

  async exportUsdz(object) {
    const { USDZExporter } = await import('jsm/exporters/USDZExporter.js');

    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(object);

    this.saveFile(result, `${object.name || 'object'}.usdz`, 'model/vnd.usdz+zip');
    console.log('Exported USDZ:', object.name || object.uuid);
  }
}