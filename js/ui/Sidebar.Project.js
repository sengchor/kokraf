import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

export class SidebarProject {
  constructor(editor) {
    this.editor = editor;
    this.config = editor.config;
    this.renderer = editor.renderer;

    this.antialiasCheckbox = document.getElementById('antialias');
    this.shadowsCheckbox = document.getElementById('shadows');
    this.shadowTypeSelect = document.getElementById('shadows-options');
    this.tonemappingSelect = document.getElementById('tonemapping-options');

    this.shadingSelect = document.getElementById('shading-options');
    this.samplesSetting = document.getElementById('samples-setting');
    this.samplesInput = document.getElementById('pathtracerSamples');
    this.widthInput = document.getElementById('image-width');
    this.heightInput = document.getElementById('image-height');
    this.renderImageBtn = document.getElementById('image-render-button');

    this.setupShadingUI();
    this.init();
  }

  init() {
    this.initRendererSettingsUI();
    this.initImageRenderUI();
  }

  setupShadingUI() {
    const updateSamplesVisibility = () => {
      this.samplesSetting.style.display = this.shadingSelect.value === 'realistic' ? 'flex' : 'none';
    };

    updateSamplesVisibility();
    this.shadingSelect.addEventListener('change', updateSamplesVisibility);
  }

  initRendererSettingsUI() {
    this.antialiasCheckbox.checked = this.config.get('antialias');
    this.shadowsCheckbox.checked = this.config.get('shadows');
    this.shadowTypeSelect.value = this.config.get('shadowType');
    this.tonemappingSelect.value = this.config.get('tonemapping');

    this.antialiasCheckbox.addEventListener('change', () => {
      const confirmed = confirm('Changing antialiasing requires reloading the page. Do you want to continue?');

      if (confirmed) {
        this.config.set('antialias', this.antialiasCheckbox.checked);
        window.location.reload();
      } else {
        this.antialiasCheckbox.checked = this.config.get('antialias');
      }
    });

    this.shadowsCheckbox.addEventListener('change', () => {
      this.config.set('shadows', this.shadowsCheckbox.checked);
      this.renderer.applyConfig();
    });

    this.shadowTypeSelect.addEventListener('change', () => {
      this.config.set('shadowType', parseInt(this.shadowTypeSelect.value));
      this.renderer.applyConfig();
    });

    this.tonemappingSelect.addEventListener('change', () => {
      this.config.set('tonemapping', parseInt(this.tonemappingSelect.value));
      this.renderer.applyConfig();
    });
  }

  initImageRenderUI() {
    this.renderImageBtn.addEventListener('click', () => {
      this.renderImage();
    });
  }

  renderImage() {
    const width = Math.max(1, Math.min(10000, parseInt(this.widthInput.value || 0)));
    const height = Math.max(1, Math.min(10000, parseInt(this.heightInput.value || 0)));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      alert('Please enter a valid width / height (1-10000).');
      return;
    }

    const scene = this.editor.sceneManager.mainScene;
    const baseCamera = this.editor.cameraManager.camera;
    const renderCamera = baseCamera.clone();
    renderCamera.aspect = width / height;
    renderCamera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);

    if (this.shadingSelect.value === 'realistic' && !this.validateSceneMaterials(scene)) {
      alert('Only MeshStandardMaterial / MeshPhysicalMaterial are supported.');
      return;
    }

    const output = this.openRenderPopup(renderer, width, height);
    if (!output) return;

    if (this.shadingSelect.value === 'solid') {
      renderer.render(scene, renderCamera);
    } else if (this.shadingSelect.value === 'realistic') {
      this.startPathTracer(scene, renderCamera, renderer, output);
    }

    renderer.dispose();
    renderCamera.removeFromParent();
  }

  startPathTracer(scene, camera, renderer, output) {
    // Build a progress overlay in the pop‑up
    const status = document.createElement('div');
    status.style.cssText = `
      position:absolute;top:10px;left:10px;color:#fff;
      font:12px system-ui;pointer-events:none;
    `;
    output.document.body.appendChild(status);

    // Init the path‑tracer
    const tracer = new WebGLPathTracer(renderer);
    tracer.setScene(scene, camera);
    tracer.tiles.set(3, 3);
    const maxSamples = Math.max(5, Math.min(8192,
                      parseInt(this.samplesInput?.value ?? 64)));

    // Progressive render loop
    function sample() {

      if (output.closed) return;

      tracer.renderSample();
      const s = tracer.samples;

      const pct = Math.floor(s / maxSamples * 100);
      status.textContent = `${s} / ${maxSamples} (${pct} %)`;

      if (s < maxSamples) requestAnimationFrame(sample);
      else status.textContent += ' ✓';
    }
    sample();
  }

  openRenderPopup(renderer, width, height) {
    const popupWidth = width / window.devicePixelRatio;
    const popupHeight = height / window.devicePixelRatio;
    const left = (screen.width - popupWidth) / 2;
    const top = (screen.height - popupHeight) / 2;

    const output = window.open('', '_blank', `location=no,left=${left},top=${top},width=${popupWidth},height=${popupHeight}`);

    if (!output) {
      alert('Pop-up blocked. Please allow pop-ups for this site.');
      return;
    }

    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0';
    output.document.head.appendChild(meta);

    output.document.body.style.background = '#000';
    output.document.body.style.margin = '0';
    output.document.body.style.overflow = 'hidden';

    const canvas = renderer.domElement;
    canvas.style.width = `${popupWidth}px`;
    canvas.style.height = `${popupHeight}px`;
    output.document.body.appendChild(canvas);

    return output;
  }

  validateSceneMaterials(scene) {
    let valid = true;

    scene.traverseVisible((object) => {
      if (!valid) return;

      if (object.isMesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of materials) {
          if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) {
            valid = false;
            break;
          }
        }
      }
    });

    return valid;
  }
}