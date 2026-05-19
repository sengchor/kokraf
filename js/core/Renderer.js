import * as THREE from 'three';
import { Outline } from './Outline.js';

export default class Renderer {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    
    this.canvas = document.getElementById('three-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.config.get('antialias')});
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;

    this.outline = new Outline(this.renderer);

    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() => this.dispose());

    this.signals.viewportShadingChanged.add((shadingMode) => {
      this.outline.enabled = shadingMode !== 'material' && shadingMode !== 'wireframe';
    });
  }

  applyConfig() {
    this.renderer.shadowMap.enabled = this.config.get('shadows');

    this.renderer.shadowMap.type = {
      0: THREE.BasicShadowMap,
      1: THREE.PCFShadowMap,
      2: THREE.PCFSoftShadowMap
    }[this.config.get('shadowType')];

    this.renderer.toneMapping = {
      0: THREE.NoToneMapping,
      1: THREE.LinearToneMapping,
      2: THREE.ReinhardToneMapping,
      3: THREE.CineonToneMapping,
      4: THREE.ACESFilmicToneMapping,
      5: THREE.AgXToneMapping,
      6: THREE.NeutralToneMapping
    }[this.config.get('tonemapping')];
  }

  get domElement() {
    return this.renderer.domElement;
  }

  setSize(width, height) {
    this.renderer.setSize(width, height);
    this.outline.setSize(width * window.devicePixelRatio, height * window.devicePixelRatio);
  }

  clearAll() {
    this.renderer.clear();
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  renderWithOutline(scene, camera) {
    this.outline.render(scene, camera);
  }

  dispose() {
    this.outline.dispose();
    this.renderer.dispose();
  }

  captureThumbnail(sceneManager, camera, width = 480, height = 270) {
    const currentSize = new THREE.Vector2();
    this.renderer.getSize(currentSize);

    const originalAspect = camera.aspect;
    const originalPixelRatio = this.renderer.getPixelRatio();

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.clear();

    this.renderer.render(sceneManager.mainScene, camera);
    this.renderer.render(sceneManager.sceneHelpers, camera);
    this.renderer.render(sceneManager.sceneEditorHelpers, camera);

    const blob = new Promise((resolve) => {
      this.renderer.domElement.toBlob((b) => resolve(b), 'image/webp', 0.8);
    });

    this.renderer.setPixelRatio(originalPixelRatio);
    this.renderer.setSize(currentSize.x, currentSize.y);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();

    return blob;
  }

  captureForSD(sceneManager, camera, size = 512) {
    const currentSize = new THREE.Vector2();
    this.renderer.getSize(currentSize);

    const originalAspect = camera.aspect;
    const originalPixelRatio = this.renderer.getPixelRatio();

    camera.aspect = 1;
    camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
    this.renderer.clear();
    this.renderer.render(sceneManager.mainScene, camera);

    const blob = new Promise((resolve) => {
      this.renderer.domElement.toBlob((b) => resolve(b), 'image/png');
    });

    this.renderer.setPixelRatio(originalPixelRatio);
    this.renderer.setSize(currentSize.x, currentSize.y);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();

    return blob;
  }

  captureNormalMap(sceneManager, camera, size = 512) {
    sceneManager.updateShadingMode('material', false);

    const currentSize = new THREE.Vector2();
    this.renderer.getSize(currentSize);
    const originalAspect = camera.aspect;

    camera.aspect = 1;
    camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
    this.renderer.clear();

    // Override all materials with MeshNormalMaterial
    const saved = [];
    sceneManager.mainScene.traverse(obj => {
      if (!obj.isMesh) return;
      saved.push({ obj, mat: obj.material });
      obj.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    });

    this.renderer.render(sceneManager.mainScene, camera);

    // Restore
    saved.forEach(({ obj, mat }) => {
      obj.material.dispose();
      obj.material = mat;
    });

    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    offscreen.getContext('2d').drawImage(this.renderer.domElement, 0, 0);

    const blob = new Promise(resolve => {
      offscreen.toBlob(b => resolve(b), 'image/png');
    });

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(currentSize.x, currentSize.y);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();

    sceneManager.updateShadingMode('solid', false);

    return blob;
  }
}