import * as THREE from 'three';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { ProjectionPainter } from './ProjectionPainter.js';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { PaintStrokeCommand } from '../commands/PaintStrokeCommand.js';
import { SwitchPaintMapCommand } from '../commands/SwitchPaintMapCommand.js';
import { GPUDepthReader } from '../utils/GPUDepthReader.js';
import { PaintTool } from './PaintTool.js';
import { EraseTool } from './EraseTool.js';

const COLOR_TYPE_BY_MAP = {
  map: 'rgb',
  metalnessMap: 'grayscale',
  roughnessMap: 'grayscale',
  normalMap: 'rgb',
};

export class TexturePainter {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.object = null;
    this.isActive = false;
    this.isPainting = false;
    this.lastHit = null;

    this.tools = {
      paint: new PaintTool(),
      erase: new EraseTool(() => this.baseImageData),
    };
    this.tool = this.tools.paint;
    
    this.paintMap = 'map';
    this.originalMaterial = null;
    this.previewMaterial = null;

    // Brush
    this.color = '#ffffff';
    this.size = 20;
    this.opacity = 1.0;
    this.hardness = 0.8;

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

    this._initBrushControls();
    this._initPaintMapControl();
    this.setupListeners();
  }

  async attach(object) {
    this._domElement.style.cursor = 'none';
    this.brushCursor.style.display = 'block';
    this.setSize(this.size);

    if (this.object !== object) {
      this._disposeAllMaps();
      this.projectionPainter = null;
    }

    this.object = object;
    this.isActive = false;

    this.originalMaterial = object.material || new THREE.MeshStandardMaterial();
    this.previewMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.5,
      roughness: 0.2,
    });

    const bakeMesh = await this._ensureUVs(object);

    this._maps = {};
    this._switchPaintMap(this.paintMap);

    if (!this.projectionPainter) {
      this.projectionPainter = new ProjectionPainter();
    }
    this.projectionPainter.attach(object, this.paintCanvas, bakeMesh);

    this._showPreviewMaterial();
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

    if (this.object && this.originalMaterial) {
      this.object.material = this.originalMaterial;
    }

    this._disposeAllMaps();
    if (this.previewMaterial) {
      this.previewMaterial.dispose();
      this.previewMaterial = null;
    }

    this.object = null;
    this.originalMaterial = null;
    this.previewMaterial = null;

    this._domElement.style.cursor = '';
    this.brushCursor.style.display = 'none';
  }

  setupListeners() {
    this.signals.setPaintTool.add((name) => {
      this.setTool(name);
    });
  }

  setTool(name) {
    if (!this.tools[name]) return;
    this.tool = this.tools[name];
    this._syncBrushControlsUI();
  }

  _createMapEntry(mapKey) {
    const existingMap = this.originalMaterial?.[mapKey];
    const existingImage = existingMap?.image;

    const resolution = existingImage
      ? Math.min(Math.max(existingImage.width, existingImage.height), 2048)
      : this._resolution;

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = baseCanvas.height = resolution;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    baseCtx.fillStyle = this._defaultFillColor(mapKey);
    baseCtx.fillRect(0, 0, resolution, resolution);
    const baseImageData = baseCtx.getImageData(0, 0, resolution, resolution);

    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = paintCanvas.height = resolution;
    const paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    paintCtx.drawImage(baseCanvas, 0, 0);
    if (existingImage) paintCtx.drawImage(existingImage, 0, 0, resolution, resolution);

    const texture = new THREE.CanvasTexture(paintCanvas);
    texture.colorSpace = mapKey === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;

    return { resolution, baseCanvas, baseCtx, baseImageData, paintCanvas, paintCtx, texture };
  }

  _defaultFillColor(mapKey) {
    switch (mapKey) {
      case 'map': return '#dcdcdc';
      case 'metalnessMap': return '#000000';
      case 'roughnessMap': return '#808080';
      case 'normalMap': return '#8080ff';
      default: return '#dcdcdc';
    }
  }

  _switchPaintMap(mapKey) {
    if (!this.object) return;

    let entry = this._maps[mapKey];
    if (!entry) {
      entry = this._createMapEntry(mapKey);
      this._maps[mapKey] = entry;
    }

    this.baseCanvas = entry.baseCanvas;
    this.baseCtx = entry.baseCtx;
    this.baseImageData = entry.baseImageData;
    this.paintCanvas = entry.paintCanvas;
    this.paintCtx = entry.paintCtx;
    this.texture = entry.texture;
    this._resolution = entry.resolution;

    if (this.originalMaterial) {
      this.originalMaterial[mapKey] = entry.texture;
      this.originalMaterial.needsUpdate = true;
    }

    this._showPreviewMaterial();
    this.projectionPainter?.setPaintCanvas(this.paintCanvas);

    this._syncBrushControlsUI();
  }

  _showPreviewMaterial() {
    if (!this.object || !this.texture) return;

    this.previewMaterial.map = this.texture;
    this.previewMaterial.side = this.originalMaterial?.side ?? THREE.FrontSide;
    this.previewMaterial.needsUpdate = true;

    this.object.material = this.previewMaterial;
  }

  getMapKey(type) {
    const mapTypes = {
      baseColor: 'map',
      metalness: 'metalnessMap',
      roughness: 'roughnessMap',
      normal: 'normalMap',
    };

    return mapTypes[type] ?? 'map';
  }

  getPaintType(mapKey) {
    const mapTypes = {
      map: 'baseColor',
      metalnessMap: 'metalness',
      roughnessMap: 'roughness',
      normalMap: 'normal',
    };

    return mapTypes[mapKey] ?? 'baseColor';
  }

  setPaintMap(mapKey) {
    if (mapKey === this.paintMap && this.texture) return;

    this.paintMap = mapKey;

    const type = this.getPaintType(mapKey);

    const select = document.getElementById('paint-map-select');
    if (select && select.value !== type) {
      select.value = type;
    }

    this._switchPaintMap(mapKey);
  }

  _restoreOriginalMaterial() {
    if (!this.isActive || !this.object || !this.originalMaterial) return false;

    this.object.material = this.originalMaterial;
    return true;
  }

  _restorePreviewMaterial() {
    if (!this.isActive || !this.object || !this.previewMaterial) return;

    this.object.material = this.previewMaterial;
  }

  _updateBrushCursor(event) {
    const rect = this._domElement.getBoundingClientRect();

    this.brushCursor.style.left = `${event.clientX - rect.left}px`;
    this.brushCursor.style.top = `${event.clientY - rect.top}px`;
    this.brushCursor.style.width = `${this.size * 2}px`;
    this.brushCursor.style.height = `${this.size * 2}px`;
  }

  async _ensureUVs(object) {
    const meshData = object.userData.meshData;

    let bakeGeometry;

    if (AutoUVUnwrap.hasUVs(meshData)){
      bakeGeometry = object.geometry;
    } else {
      const uvOutput = await AutoUVUnwrap.unwrap(meshData);

      if (!uvOutput?.positions?.length || !uvOutput.indices.length) {
        throw new Error(`UV unwrap failed for "${object.name}".`);
      }

      bakeGeometry = AutoUVUnwrap._buildOutputGeometry(uvOutput);
    }

    this.editor.vertexEditor.setObject(object);
    this.editor.vertexEditor.updateGeometry();

    const tempBakeMesh = new THREE.Mesh(bakeGeometry);
    tempBakeMesh.matrixWorld.copy(object.matrixWorld);

    this.bakeMesh = tempBakeMesh;
    return tempBakeMesh;
  }

  restoreBaseSnapshot() {
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = this._resolution;
    this.baseCanvas.height = this._resolution;
    this.baseCtx = this.baseCanvas.getContext('2d', { willReadFrequently: true });

    this.baseCtx.fillStyle = '#dcdcdc';
    this.baseCtx.fillRect(0, 0, this._resolution, this._resolution);

    this.baseImageData = this.baseCtx.getImageData(0, 0, this._resolution, this._resolution);
  }

  _initPaintCanvas(existingImage) {
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = this._resolution;
    this.paintCanvas.height = this._resolution;
    this.paintCtx = this.paintCanvas.getContext('2d', { willReadFrequently: true });

    this.paintCtx.drawImage(this.baseCanvas, 0, 0);

    if (existingImage) {
      this.paintCtx.drawImage(existingImage, 0, 0, this._resolution, this._resolution);
    }
  }

  _initBrushControls() {
    this._brushEls = {
      color: document.getElementById('brush-color'),
      colorControl: document.getElementById('brush-color-control'),
      value: document.getElementById('brush-value'),
      valueControl: document.getElementById('brush-value-control'),
      valueDisplay: document.getElementById('brush-value-value'),
      size: document.getElementById('brush-size'),
      opacity: document.getElementById('brush-opacity'),
      hardness: document.getElementById('brush-hardness'),
      sizeValue: document.getElementById('brush-size-value'),
      opacityValue: document.getElementById('brush-opacity-value'),
      hardnessValue: document.getElementById('brush-hardness-value'),
    };

    const { color, value, valueDisplay, size, opacity, hardness, sizeValue, opacityValue, hardnessValue } = this._brushEls;

    color.addEventListener('input', (e) => {
      this.setColor(e.target.value);
    });

    value.addEventListener('input', (e) => {
      const frac = Number(e.target.value);
      this.setColor(this._grayHexFromFraction(frac));
      valueDisplay.textContent = frac.toFixed(2);
    });

    size.addEventListener('input', (e) => {
      const value = Number(e.target.value);
      this.setSize(value);
      sizeValue.textContent = value;
    });

    opacity.addEventListener('input', (e) => {
      const value = Number(e.target.value);
      this.setOpacity(value);
      opacityValue.textContent = value.toFixed(2);
    });

    hardness.addEventListener('input', (e) => {
      const value = Number(e.target.value);
      this.setHardness(value);
      hardnessValue.textContent = value.toFixed(2);
    });

    this._syncBrushControlsUI();
  }

  _initPaintMapControl() {
    const select = document.getElementById('paint-map-select');
    select?.addEventListener('change', (e) => {
      const type = e.target.value;
      const key = this.getMapKey(type);

      if (key === this.paintMap) return;
      
      this.editor.execute(new SwitchPaintMapCommand(this.editor, this.object, key, this.paintMap));
     });
  }

  _syncBrushControlsUI() {
    const {
      color, value, valueDisplay, colorControl, valueControl,
      size, opacity, hardness, sizeValue, opacityValue, hardnessValue,
    } = this._brushEls;

    const usesColor = this.tool.usesColor !== false;
    const isGrayscale = this._getColorType(this.paintMap) === 'grayscale';

    colorControl.classList.toggle('hidden', isGrayscale);
    valueControl.classList.toggle('hidden', !isGrayscale);

    if (isGrayscale) {
      value.disabled = !usesColor;
      valueControl.classList.toggle('is-disabled', !usesColor);
      const frac = this._grayFractionFromHex(this.color);
      value.value = frac;
      valueDisplay.textContent = frac.toFixed(2);
    } else {
      color.disabled = !usesColor;
      color.parentElement?.classList.toggle('is-disabled', !usesColor);
      color.value = this.color;
    }

    size.value = this.size;
    sizeValue.textContent = this.size;

    opacity.value = this.opacity;
    opacityValue.textContent = this.opacity.toFixed(2);

    hardness.value = this.hardness;
    hardnessValue.textContent = this.hardness.toFixed(2);
  }

  resetBrush() {
    this.color = '#ffffff';
    this.size = 20;
    this.opacity = 1.0;
    this.hardness = 0.8;

    this._syncBrushControlsUI();
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

    this._strokeBefore = this.paintCtx.getImageData(0, 0, this.paintCanvas.width, this.paintCanvas.height);
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
      const _strokeAfter = this.paintCtx.getImageData(0, 0, this.paintCanvas.width, this.paintCanvas.height);
      this.editor.execute(new PaintStrokeCommand(this.editor, this.object, this.paintMap, this._strokeBefore, _strokeAfter));
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
      tool: this.tool,
      projection: {
        camera,
        viewDir,
        depthReader: this.depthReader,
        worldQueryRadius,
      },
    };

    const touched = this.projectionPainter.paintDab(paintContext);
    this._strokeTouched = this._strokeTouched || touched;

    if (touched) {
      this.texture.needsUpdate = true;
    }
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
    return new Promise(resolve => this.paintCanvas.toBlob(resolve, type));
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

  _disposeAllMaps() {
    if (this._maps) {
      for (const key in this._maps) {
        if (this._maps[key]?.texture) {
          this._maps[key].texture.dispose();
        }
      }
      this._maps = {};
    }
    
    this.texture = null;
    this.paintCanvas = null;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.paintCtx = null;
    this.baseImageData = null;
  }

  _getColorType(mapKey) {
    return COLOR_TYPE_BY_MAP[mapKey] ?? 'rgb';
  }

  _grayHexFromFraction(frac) {
    const v = Math.round(frac * 255);
    const hex = v.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }

  _grayFractionFromHex(hex) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance / 255;
  }

  toJSON() {
    return {
      color: this.color,
      size: this.size,
      opacity: this.opacity,
      hardness: this.hardness,
    };
  }

  fromJSON(json) {
    if (!json) return;

    if (json.color !== undefined) this.setColor(json.color);
    if (json.size !== undefined) this.setSize(json.size);
    if (json.opacity !== undefined) this.setOpacity(json.opacity);
    if (json.hardness !== undefined) this.setHardness(json.hardness);

    this._syncBrushControlsUI();
  }
}