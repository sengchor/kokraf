import * as THREE from 'three';
import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'jsm/lines/LineSegments2.js';

export class GPUEdgePicker {
  constructor(editor) {
    this.editor = editor;
    this.renderer = editor.renderer.renderer;
    this.scene = new THREE.Scene();
    this.depthScene = new THREE.Scene();
    this.buildRenderTarget();
    this.pickLine = null;
    this.dirty = false;
    this._pixelBuffer = null;
  }

  buildRenderTarget() {
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    if (this.renderTarget) this.renderTarget.dispose();
    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      stencilBuffer: false
    });
  }

  dispose() {
    this.renderTarget.dispose();
    
    if (this.pickLine) {
      this.scene.clear();
      this.pickLine.material.dispose();
    }

    this.depthScene.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.dispose();
      }
    });

    this.depthScene.clear();
  }

  resize(width, height) {
    const pr = this.renderer.getPixelRatio();
    this.renderTarget.setSize(width * pr, height * pr);
    if (this.pickLine) this.pickLine.material.resolution.set(width, height);
    this.dirty = true;
  }

  buildFromHelper(edgeHelper) {
    if (this.pickLine) {
      this.scene.remove(this.pickLine);
      this.pickLine.material.dispose();
    }

    const geometry = edgeHelper.geometry.clone();
    const edgeIds = edgeHelper.userData.edgeIdList;

    const colorStart = new Float32Array(edgeIds.length * 3);
    const colorEnd   = new Float32Array(edgeIds.length * 3);

    for (let i = 0; i < edgeIds.length; i++) {
      const id = edgeIds[i] + 1; // +1 so id=0 → (0,0,1), never confused with background

      const r = ((id >> 16) & 255) / 255;
      const g = ((id >>  8) & 255) / 255;
      const b = ( id        & 255) / 255;

      const offset = i * 3;
      colorStart[offset] = colorEnd[offset] = r;
      colorStart[offset + 1] = colorEnd[offset + 1] = g;
      colorStart[offset + 2] = colorEnd[offset + 2] = b;
    }

    geometry.setAttribute('instanceColorStart', new THREE.InstancedBufferAttribute(colorStart, 3));
    geometry.setAttribute('instanceColorEnd',   new THREE.InstancedBufferAttribute(colorEnd,   3));

    const material = new LineMaterial({
      linewidth: 3.0,
      vertexColors: true,
      depthTest: true,
      depthWrite: true,
      transparent: false
    });
    material.resolution.set(
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight
    );

    this.pickLine = new LineSegments2(geometry, material);
    this.pickLine.matrixAutoUpdate = false;
    this.pickLine.matrix.copy(edgeHelper.matrix);
    this.scene.add(this.pickLine);

    this.dirty = true;
  }

  buildFromObject(object) {
    this.depthScene.clear();

    const depthMesh = object.clone();

    depthMesh.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshBasicMaterial({
          colorWrite: false
        });
      }
    });

    this.depthScene.add(depthMesh);
  }

  render(camera) {
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.clear();
    this.renderer.render(this.depthScene, camera);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    this.dirty = false;
  }

  pickSegment(ax, ay, bx, by, camera) {
    if (this.dirty) this.render(camera);

    const ids = new Set();
    const HALF_WIDTH = 4;
    const rtW = this.renderTarget.width;
    const rtH = this.renderTarget.height;

    // Bounding box of segment + padding
    const x0 = Math.max(0,       Math.floor(Math.min(ax, bx)) - HALF_WIDTH);
    const y0 = Math.max(0,       Math.floor(Math.min(ay, by)) - HALF_WIDTH);
    const x1 = Math.min(rtW - 1, Math.ceil (Math.max(ax, bx)) + HALF_WIDTH);
    const y1 = Math.min(rtH - 1, Math.ceil (Math.max(ay, by)) + HALF_WIDTH);

    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;

    // Reuse buffer — avoids a GC allocation on every pointermove
    const needed = w * h * 4;
    if (!this._pixelBuffer || this._pixelBuffer.length < needed) {
      this._pixelBuffer = new Uint8Array(needed);
    }

    // ONE readback for the whole region (readRenderTargetPixels origin is bottom-left)
    this.renderer.readRenderTargetPixels(
      this.renderTarget,
      x0, rtH - y1 - 1,
      w, h,
      this._pixelBuffer
    );

    for (let py = 0; py < h; py++) {
      // readback rows are bottom-up → convert back to canvas-y for the distance check
      const screenY = y1 - py;

      for (let px = 0; px < w; px++) {
        const screenX = x0 + px;

        if (this._distToSegment(screenX, screenY, ax, ay, bx, by) > HALF_WIDTH) continue;

        const idx = (py * w + px) * 4;
        const encoded = (this._pixelBuffer[idx] << 16) | (this._pixelBuffer[idx + 1] << 8) | this._pixelBuffer[idx + 2];
        if (encoded !== 0) ids.add(encoded - 1);
      }
    }

    return ids;
  }

  _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
}