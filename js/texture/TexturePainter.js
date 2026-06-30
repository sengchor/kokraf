import * as THREE from 'three';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';

export class TexturePainter {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.object = null;
    this.isActive = false;
    this.isPainting = false;
    this.lastUV = null;

    // Brush
    this.color = '#ffffff';
    this.size = 20;
    this.opacity = 1.0;
    this.hardness = 0.8;
    this.blendMode = 'source-over';

    // Canvas state
    this.canvas = null;
    this.ctx = null;
    this.texture = null;
    this._resolution = 1024;

    this._raycaster = new THREE.Raycaster();
    this._domElement = editor.renderer.renderer.domElement;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  async attach(object) {
    if (this.texture && this.object !== object) {
      this.texture.dispose();
      this.texture = null;
      this.canvas = null;
    }

    this.object = object;
    this.isActive = false;

    // const geo = object.geometry;
    // if (!geo.attributes.uv) {
    //   await this._ensureUVs(object);
    // }

    await this._ensureUVs(object);

    this._initCanvas();
    this._applyToMaterial();
    this._bindEvents();
    this.isActive = true;
  }

  detach() {
    if (!this.isActive && !this.isPainting) return;
    this._unbindEvents();
    this.isActive = false;
    this.isPainting = false;
    this.lastUV = null;
    this.object = null;
  }

  async _ensureUVs(object) {
    const uvOutput = await AutoUVUnwrap.unwrap(object.userData.meshData);

    if (!uvOutput?.positions?.length || !uvOutput.indices.length) {
      throw new Error(`UV unwrap failed for "${object.name}".`);
    }

    this.editor.vertexEditor.setObject(object);
    this.editor.vertexEditor.updateGeometry();
  }

  _initCanvas() {
    if (this.texture && this.object.material?.map === this.texture) return;

    const existingMap = this.object.material?.map;
    const existingImage = existingMap?.image;

    const res = existingImage ?
      Math.min(Math.max(existingImage.width, existingImage.height), 2048) : this._resolution;
    this._resolution = res;

    this.canvas = document.createElement('canvas');
    this.canvas.width = res;
    this.canvas.height = res;
    this.ctx = this.canvas.getContext('2d');

    if (existingImage) {
      this.ctx.drawImage(existingImage, 0, 0, res, res);
    } else {
      this.ctx.fillStyle = '#808080';
      this.ctx.fillRect(0, 0, res, res);
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  _applyToMaterial() {
    const mat = this.object.material;
    if (!mat) {
      this.object.material = new THREE.MeshStandardMaterial({ map: this.texture });
    } else {
      mat.map = this.texture;
      mat.needsUpdate = true;
    }
  }

  _bindEvents() {
    this._domElement.addEventListener('pointerdown', this._onPointerDown);
    this._domElement.addEventListener('pointermove', this._onPointerMove);
    this._domElement.addEventListener('pointerup', this._onPointerUp);
  }

  _unbindEvents() {
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('pointermove', this._onPointerMove);
    this._domElement.removeEventListener('pointerup', this._onPointerUp);
  }

  _onPointerDown(event) {
    if (event.button !== 0 || !this.isActive) return;
    event.stopPropagation();

    this.isPainting = true;
    this._domElement.setPointerCapture(event.pointerId);
    
    const uv = this._getUV(event);
    this.lastUV = uv;
    this._paintAt(uv);
  }

  _onPointerMove(event) {
    if (!this.isPainting) return;
    event.stopPropagation();

    const uv = this._getUV(event);
    this._paintAt(uv, this.lastUV);
    if (uv) this.lastUV = uv;
  }

  _onPointerUp(event) {
    if (!this.isPainting) return;
    this.isPainting = false;
    this.lastUV = null;
    this._domElement.releasePointerCapture(event.pointerId);
  }

  _getUV(event) {
    const rect = this._domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width)  *  2 - 1,
      ((event.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    const camera = this.editor.cameraManager.camera;
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster.intersectObject(this.object, false);
    return hits.length > 0 ? hits[0].uv : null;
  }

  _paintAt(uv, prevUV = null) {
    if (!uv || !this.ctx) return;

    const { width, height } = this.canvas;
    const x = uv.x * width;
    const y = (1 - uv.y) * height;

    this.ctx.globalCompositeOperation = this.blendMode;
    this.ctx.globalAlpha = this.opacity;

    if (prevUV !== null) {
      const px = prevUV.x * width;
      const py = (1 - prevUV.y) * height;
      const dist = Math.hypot(x - px, y - py);
      const spacing = Math.max(1, this.size * 0.25);
      const steps = Math.max(1, Math.ceil(dist / spacing));

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        this._drawDab(px + (x - px) * t, py + (y - py) * t);
      }
    } else {
      this._drawDab(x, y);
    }

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;

    this.texture.needsUpdate = true;
  }

  _drawDab(x, y) {
    const r = this.size;
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, this._toRGBA(this.color, 1));
    gradient.addColorStop(this.hardness, this._toRGBA(this.color, 1));
    gradient.addColorStop(1, this._toRGBA(this.color, 0));

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _toRGBA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  setColor(hex) { this.color = hex; }
  setSize(px) { this.size = Math.max(1, px); }
  setOpacity(v) { this.opacity = Math.max(0, Math.min(1, v)); }
  setHardness(v) { this.hardness = Math.max(0, Math.min(1, v)); }
  setBlendMode(op) { this.blendMode = op; }

  toBlob(type = 'image/png') {
    return new Promise(resolve => this.canvas.toBlob(resolve, type));
  }
}