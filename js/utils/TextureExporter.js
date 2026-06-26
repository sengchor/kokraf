import * as THREE from 'three';

const TEXTURE_SLOTS = [
  { key: 'map', suffix: 'albedo', format: 'image/png' },
  { key: 'normalMap', suffix: 'normal', format: 'image/png' },
  { key: 'roughnessMap', suffix: 'roughness', format: 'image/png' },
  { key: 'metalnessMap', suffix: 'metalness', format: 'image/png' },
  { key: 'emissiveMap', suffix: 'emissive', format: 'image/png' },
  { key: 'aoMap', suffix: 'ao', format: 'image/png' },
  { key: 'displacementMap', suffix: 'displacement', format: 'image/png' },
  { key: 'alphaMap', suffix: 'alpha', format: 'image/png' },
];

export class TextureExporter {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this._threeRenderer = editor.renderer?.renderer;
  }

  async exportTextures(objects) {
    const meshes = objects.filter(o => o?.isMesh && o.material);
    if (meshes.length === 0) return 0;

    this.signals.disableKeyHandler.dispatch(true);

    try {
      const entries = await this._collectEntries(meshes);

      if (entries.length === 0) {
        alert('[Texture Export] No exportable textures found on selected objects.');
        return 0;
      }

      if (entries.length === 1) {
        this._triggerDownload(entries[0].blob, entries[0].filename);
      } else {
        await this._downloadAll(entries);
      }

      return entries.length;
    } finally {
      this.signals.disableKeyHandler.dispatch(false);
    }
  }

  async _collectEntries(meshes) {
    const entries = [];
    const seen = new Set();

    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const baseName = this._safeName(mesh.name || 'mesh');

      for (const material of materials) {
        if (!material) continue;

        for (const { key, suffix, format } of TEXTURE_SLOTS) {
          const texture = material[key];
          if (!texture?.isTexture) continue;
          if (seen.has(texture.uuid)) continue;
          seen.add(texture.uuid);

          const blob = await this._textureToBlob(texture, format);
          if (!blob) continue;

          const ext = format === 'image/jpeg' ? 'jpg' : 'png';
          entries.push({ filename: `${baseName}_${suffix}.${ext}`, blob});
        }
      }
    }

    return entries;
  }

  async _textureToBlob(texture, mimeType = 'image/png') {
    const { image } = texture;

    if (
      image instanceof HTMLImageElement ||
      image instanceof HTMLCanvasElement ||
      image instanceof ImageBitmap ||
      image instanceof HTMLVideoElement
    ) {
      return this._imageToBlobViaCanvas(image, mimeType);
    }

    if (image?.data) {
      return this._dataToBlob(image, mimeType);
    }

    if (this._threeRenderer) {
      return this.readBackViaGPU(texture, mimeType);
    }

    return null;
  }

  _imageToBlobViaCanvas(source, mimeType) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width ?? source.naturalWidth ?? source.videoWidth ?? 1;
    canvas.height = source.height ?? source.naturalHeight ?? source.videoHeight ?? 1;
    canvas.getContext('2d').drawImage(source, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, mimeType));
  }

  _dataToBlob(image, mimeType) {
    const { width, height, data } = image;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    if (data.length === width * height * 3) {
      for (let i = 0; i < width * height; i++) {
        imgData.data[i * 4] = data[i * 3];
        imgData.data[i * 4 + 1] = data[i * 3 + 1];
        imgData.data[i * 4 + 2] = data[i * 3 + 2];
        imgData.data[i * 4 + 3] = 255;
      }
    } else {
      imgData.data.set(
        data instanceof Uint8ClampedArray
          ? data
          : new Uint8ClampedArray(data.buffer ?? data)
      );
    }

    ctx.putImageData(imgData, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, mimeType));
  }

  async _readBackViaGPU(texture, mimeType) {
    const renderer = this._threeRenderer;
    const w = texture.image?.width ?? 512;
    const h = texture.image?.height ?? 512;

    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });

    const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE.MeshBasicMaterial({ map: texture, depthTest: false });
    const blitMesh = new THREE.Mesh(blitGeo, blitMat);
    const blitScene = new THREE.Scene();
    blitScene.add(blitMesh);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(blitScene, blitCamera);
    renderer.setRenderTarget(prevTarget);

    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);

    rt.dispose();
    blitGeo.dispose();
    blitMat.dispose();

    // WebGL pixel rows are bottom-up; flip to top-down for canvas.
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
    }

    ctx.putImageData(imgData, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, mimeType));
  }

  async _downloadAll(entries) {
    if (typeof window.JSZip !== 'undefined') {
      const zip = new window.JSZip();
      for (const { filename, blob } of entries) zip.file(filename, blob);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      this._triggerDownload(zipBlob, 'textures.zip');
    } else {
      for (const { filename, blob } of entries) {
        this._triggerDownload(blob, filename);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  _safeName(name) {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      || 'mesh';
  }
}