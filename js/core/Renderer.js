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

  captureShadedRender(sceneManager, camera, size = 512) {
    sceneManager.updateShadingMode('solid', false);

    const currentSize = new THREE.Vector2();
    this.renderer.getSize(currentSize);
    const originalPixelRatio = this.renderer.getPixelRatio();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
    this.renderer.clear();
    this.renderer.render(sceneManager.mainScene, camera);

    const blob = new Promise((resolve) => {
      this.renderer.domElement.toBlob((b) => resolve(b), 'image/png');
    });

    this.renderer.setPixelRatio(originalPixelRatio);
    this.renderer.setSize(currentSize.x, currentSize.y);

    return blob;
  }

  captureNormalRender(sceneManager, camera, size = 512) {
    sceneManager.updateShadingMode('normal', false);

    const currentSize = new THREE.Vector2();
    this.renderer.getSize(currentSize);
    const originalPixelRatio = this.renderer.getPixelRatio();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
    this.renderer.clear();

    const saved = [];
    sceneManager.mainScene.traverse(obj => {
      if (!obj.isMesh) return;
      saved.push({ obj, mat: obj.material });
      obj.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    });

    this.renderer.render(sceneManager.mainScene, camera);

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

    // Restore the renderer
    this.renderer.setPixelRatio(originalPixelRatio);
    this.renderer.setSize(currentSize.x, currentSize.y);

    return blob;
  }

  captureDepthRender(sceneManager, camera, size = 512) {
    const target = new THREE.WebGLRenderTarget(size, size);

    target.depthTexture = new THREE.DepthTexture(size, size, THREE.FloatType);

    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(sceneManager.mainScene, camera);
    this.renderer.setRenderTarget(null);

    return target.depthTexture;
  }

  async captureMultiView(selectedObject, sceneManager, camera, captureFn, size = 512) {
    const box = new THREE.Box3().setFromObject(selectedObject);
    const target = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    const captureCamera = camera.clone();
    captureCamera.aspect = 1.0;
    captureCamera.updateProjectionMatrix();

    const fov = THREE.MathUtils.degToRad(captureCamera.fov);
    const radius = sphere.radius;
    const distance = radius / Math.sin(fov / 2);

    // 4 angled directions
    const views = [
      { yaw: Math.PI * 0.25 },
      { yaw: Math.PI * 1.75 },
      { yaw: Math.PI * 1.25 },
      { yaw: Math.PI * 0.75 },
    ];

    const images = [];
    const viewSnapshots = [];

    for (const view of views) {
      const x = target.x + Math.cos(view.yaw) * distance;
      const z = target.z + Math.sin(view.yaw) * distance;

      captureCamera.position.set(x, target.y, z);
      captureCamera.up.set(0, 1, 0);
      captureCamera.lookAt(target);
      captureCamera.updateMatrixWorld();

      const vpMatrix = new THREE.Matrix4().multiplyMatrices(
        captureCamera.projectionMatrix,
        captureCamera.matrixWorldInverse,
      );

      const depthTexture = this.captureDepthRender(sceneManager, captureCamera, size);
      depthTexture.minFilter = THREE.LinearFilter;
      depthTexture.magFilter = THREE.LinearFilter;

      viewSnapshots.push({
        vpMatrix,
        camWorldPos: captureCamera.position.clone(),
        depthTexture
      });

      const blob = await captureFn.call(this, sceneManager, captureCamera, size);
      const bitmap = await createImageBitmap(blob);
      images.push(bitmap);
    }

    // Stitch images into 2x2 atlas
    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;

    const ctx = canvas.getContext('2d');

    ctx.drawImage(images[0], 0, 0, size, size);
    ctx.drawImage(images[1], size, 0, size, size);
    ctx.drawImage(images[2], size, size, size, size);
    ctx.drawImage(images[3], 0, size, size, size);

    const labelPadding = size / 512 * 20;
    const labelFontSize = size / 512 * 32;

    ctx.fillStyle = 'white';
    ctx.font = `bold ${labelFontSize}px Arial`;
    ctx.fillText('FRONT LEFT', labelPadding, labelPadding + labelFontSize);
    ctx.fillText('FRONT RIGHT', size + labelPadding, labelPadding + labelFontSize);
    ctx.fillText('BACK RIGHT', size + labelPadding, size + labelPadding + labelFontSize);
    ctx.fillText('BACK LEFT', labelPadding, size + labelPadding + labelFontSize);

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );

    return { blob, views: viewSnapshots };
  }
}