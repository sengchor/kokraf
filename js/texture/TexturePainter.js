import * as THREE from 'three';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { ProjectionPainter } from './ProjectionPainter.js';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { PaintStrokeCommand } from '../commands/PaintStrokeCommand.js';
import { GPUDepthReader } from '../utils/GPUDepthReader.js';

export class TexturePainter {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.object = null;
    this.isActive = false;
    this.isPainting = false;
    this.lastHit = null;

    // Brush
    this.color = '#ffffff';
    this.size = 20;
    this.opacity = 1.0;
    this.hardness = 0.8;

    this.canvas = null;
    this.ctx = null;
    this.texture = null;
    this.projectionPainter = null;
    this._resolution = 1024;

    this._strokeBefore = null;
    this._strokeTouched = false;

    this._raycaster = new THREE.Raycaster();
    this._domElement = editor.renderer.renderer.domElement;

    this.depthReader = new GPUDepthReader(
      editor.renderer.renderer, 
      window.innerWidth, 
      window.innerHeight
    );

    this.brushCursor = document.createElement('div');

    Object.assign(this.brushCursor.style, {
      position: 'absolute',
      border: '1px solid white',
      borderRadius: '50%',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      transform: 'translate(-50%, -50%)',
      display: 'none',
      zIndex: 1000,
    });

    this._domElement.parentElement.appendChild(this.brushCursor);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this._onPointerEnter = this._onPointerEnter.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
  }

  async attach(object) {
    this._domElement.style.cursor = 'none';
    this.brushCursor.style.display = 'block';
    this.setSize(this.size);

    if (this.texture && this.object !== object) {
      this.texture.dispose();
      this.texture = null;
      this.canvas = null;
      this.projectionPainter = null;
    }

    this.object = object;
    this.isActive = false;

    const bakeMesh = await this._ensureUVs(object);

    this._initCanvas();

    if (!this.projectionPainter) {
      this.projectionPainter = new ProjectionPainter();
    }
    this.projectionPainter.attach(object, this.canvas, bakeMesh);

    this._applyToMaterial();
    this._bindEvents();
    this.isActive = true;

    this._ensureDefaultLight();
    this.editor.selection.deselect();
    this.signals.shadingModeChanged.dispatch('material');
  }

  detach() {
    if (!this.isActive && !this.isPainting) return;
    this._unbindEvents();
    this.isActive = false;
    this.isPainting = false;
    this.lastHit = null;
    this.object = null;

    this._domElement.style.cursor = '';
    this.brushCursor.style.display = 'none';
  }

  _updateBrushCursor(event) {
    const rect = this._domElement.getBoundingClientRect();

    this.brushCursor.style.left = `${event.clientX - rect.left}px`;
    this.brushCursor.style.top = `${event.clientY - rect.top}px`;
    this.brushCursor.style.width = `${this.size * 2}px`;
    this.brushCursor.style.height = `${this.size * 2}px`;
  }

  async _ensureUVs(object) {
    const uvOutput = await AutoUVUnwrap.unwrap(object.userData.meshData);

    if (!uvOutput?.positions?.length || !uvOutput.indices.length) {
      throw new Error(`UV unwrap failed for "${object.name}".`);
    }

    this.editor.vertexEditor.setObject(object);
    this.editor.vertexEditor.updateGeometry();

    const bakeGeometry = AutoUVUnwrap._buildOutputGeometry(uvOutput);
    const tempBakeMesh = new THREE.Mesh(bakeGeometry);
    tempBakeMesh.matrixWorld.copy(object.matrixWorld);

    this.bakeMesh = tempBakeMesh;
    return tempBakeMesh;
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
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

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

    this._domElement.addEventListener('pointerenter', this._onPointerEnter);
    this._domElement.addEventListener('pointerleave', this._onPointerLeave);
  }

  _unbindEvents() {
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('pointermove', this._onPointerMove);
    this._domElement.removeEventListener('pointerup', this._onPointerUp);

    this._domElement.removeEventListener('pointerenter', this._onPointerEnter);
    this._domElement.removeEventListener('pointerleave', this._onPointerLeave);
  }

  _getHit(event) {
    const rect = this._domElement.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;

    const ndc = new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    const camera = this.editor.cameraManager.camera;
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster.intersectObject(this.object, false);
    if (!hits.length) return null;

    return {
      point: hits[0].point,
      normal: hits[0].face?.normal,
      screen: { x: sx, y: sy },
      rect: { width: rect.width, height: rect.height },
    };
  }

  _worldQueryRadius(hitPoint, camera, rect) {
    const ndc = hitPoint.clone().project(camera);
    const offsetNdc = new THREE.Vector3(ndc.x + (this.size / rect.width) * 2, ndc.y, ndc.z);
    const offsetWorld = offsetNdc.unproject(camera);
    return hitPoint.distanceTo(offsetWorld);
  }

  _onPointerDown(event) {
    if (event.button !== 0 || !this.isActive) return;
    event.stopPropagation();
    this.isPainting = true;
    this._domElement.setPointerCapture(event.pointerId);

    const camera = this.editor.cameraManager.camera;
    const scene = this.editor.sceneManager.mainScene;

    this.depthReader.updateDepthBuffer(scene, camera);

    this._strokeBefore = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this._strokeTouched = false;

    const hit = this._getHit(event);
    this.lastHit = hit;
    if (hit) this._paintAt(hit, null);
  }

  _onPointerMove(event) {
    this._updateBrushCursor(event);

    if (!this.isPainting) return;
    event.stopPropagation();
    
    let hit = this._getHit(event);

    if (!hit && this.lastHit) {
      hit = this._getVirtualHit(event, this.lastHit);
    }

    if (!hit) {
      this.lastHit = null;
      return;
    }

    this._paintAt(hit, this.lastHit);
    
    this.lastHit = hit;
  }

  _onPointerUp(event) {
    if (!this.isPainting) return;
    this.isPainting = false;
    this.lastHit = null;
    this._domElement.releasePointerCapture(event.pointerId);

    if (this._strokeTouched && this._strokeBefore) {
      const _strokeAfter = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.editor.execute(new PaintStrokeCommand(this.editor, this.object, this._strokeBefore, _strokeAfter));
    }

    this._strokeBefore = null;
    this._strokeTouched = false;
  }

  _onPointerEnter() {
    if (!this.isActive) return;

    this._domElement.style.cursor = 'none';
    this.brushCursor.style.display = 'block';
  }

  _onPointerLeave() {
    this._domElement.style.cursor = '';
    this.brushCursor.style.display = 'none';
  }

  _paintAt(hit, prevHit) {
    const camera = this.editor.cameraManager.camera;
    const viewDir = camera.getWorldDirection(new THREE.Vector3());
    const worldQueryRadius = this._worldQueryRadius(hit.point, camera, hit.rect);

    const paintContext = {
      stroke: {
        current: hit,
        previous: prevHit,
      },
      brush: {
        radius: this.size,
        color: this.color,
        opacity: this.opacity,
        hardness: this.hardness,
      },
      projection: {
        camera,
        viewDir,
        depthReader: this.depthReader,
        worldQueryRadius,
      },
    };

    const touched = this.projectionPainter.paintDab(paintContext);
    this._strokeTouched = this._strokeTouched || touched;

    this.texture.needsUpdate = true;
  }

  setColor(hex) { this.color = hex; }
  setSize(px) { 
    this.size = Math.max(1, px);

    this.brushCursor.style.width = `${this.size * 2}px`;
    this.brushCursor.style.height = `${this.size * 2}px`;
  }
  setOpacity(v) { this.opacity = Math.max(0, Math.min(1, v)); }
  setHardness(v) { this.hardness = Math.max(0, Math.min(1, v)); }

  toBlob(type = 'image/png') {
    return new Promise(resolve => this.canvas.toBlob(resolve, type));
  }

  _ensureDefaultLight() {
    let hasLight = false;
    this.editor.sceneManager.mainScene.traverse(obj => {
      if (obj.isLight) {
        hasLight = true;
      }
    });

    if (!hasLight) {
      const light = this.editor.objectFactory.createLight('Hemisphere');
      this.editor.sceneManager.addObject(light);
    }
  }

  _getVirtualHit(event, lastHit) {
    const rect = this._domElement.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const ndc = new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    
    const camera = this.editor.cameraManager.camera;
    this._raycaster.setFromCamera(ndc, camera);

    // Create a virtual plane at the last hit point, facing directly at the camera
    const planeNormal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, lastHit.point);
    const target = new THREE.Vector3();

    // Intersect the mouse ray with this invisible plane
    if (this._raycaster.ray.intersectPlane(plane, target)) {
      return {
        point: target,
        normal: lastHit.normal,
        screen: { x: sx, y: sy },
        rect: { width: rect.width, height: rect.height },
      };
    }
    
    return null;
  }
}