import * as THREE from 'three';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { SetMaterialCommand } from '../commands/SetMaterialCommand.js';
import { auth } from '/supabase/services/AuthService.js';
import { getCreditsErrorMessage } from '/supabase/services/CreditsService.js';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { TextureBaker } from '../texture/TextureBaker.js';
import { NanoBanana } from '../texture/NanoBanana.js';
import { TexturePatchFill } from '../texture/TexturePatchFill.js';

const STYLE_PROMPTS = {
  realistic: 'Texture this 3D render with realistic materials. Generate realistic and natural colors. Camera photo realism.',
  semiRealistic: 'Texture this 3D render with semi-realistic materials. Generate believable materials with slightly artistic details and balanced colors. Blend realism with stylized aesthetics.',
  stylized: 'Texture this 3D render with stylized materials. Generate stylized and saturated colors. Artistic stylized realism.',
};

export class GenerateTexturePanel {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.vertexEditor = editor.vertexEditor;
    this.renderer = editor.renderer;
    this.cameraManager = editor.cameraManager;
    this.objectFactory = editor.objectFactory;
    this.sceneManager = editor.sceneManager;

    this.generateButton = document.getElementById('generate-texture');

    this._selectedStyle = 'realistic';
    this._selectedResolution = 512;
    this._resolvePanel = null;

    this.loadPanel();
    this._bindEvents();
  }

  loadPanel() {
    const template = `
      <div id="gentex-overlay" class="gentex-overlay hidden">
        <div class="gentex-panel">
          <button id="gentex-close" class="gentex-close" aria-label="Close">✕</button>
          <h3 class="gentex-title">Generate Texture</h3>

          <div class="gentex-divider"></div>

          <div class="gentex-section">
            <div class="gentex-label">Style</div>
            <div class="gentex-style-row" id="gentex-style-row">
              <button class="gentex-style-card active" data-style="realistic">
                <span class="gentex-style-icon">📷</span>
                <span class="gentex-style-name">Realistic</span>
              </button>
              <button class="gentex-style-card" data-style="semiRealistic">
                <span class="gentex-style-icon">🌗</span>
                <span class="gentex-style-name">Semi Realistic</span>
              </button>
              <button class="gentex-style-card" data-style="stylized">
                <span class="gentex-style-icon">🎨</span>
                <span class="gentex-style-name">Stylized</span>
              </button>
            </div>
          </div>

          <div class="gentex-section">
            <div class="gentex-label">Resolution</div>
            <div class="gentex-res-row" id="gentex-res-row">
              <button class="gentex-res-btn active" data-res="512">512 px</button>
              <button class="gentex-res-btn" data-res="1024">1024 px</button>
              <button class="gentex-res-btn" data-res="2048">2048 px</button>
            </div>
          </div>

          <div class="gentex-section">
            <div class="gentex-label">
              Prompt
              <span class="gentex-label-hint">(optional)</span>
            </div>
            <textarea
              id="gentex-prompt"
              class="gentex-prompt"
              rows="3"
              maxlength="400"
              placeholder="e.g. worn leather with gold trim, mossy stone surface…"
            ></textarea>
          </div>

          <div class="gentex-actions">
            <button id="gentex-cancel" class="gentex-btn-cancel">Cancel</button>
            <button id="gentex-confirm" class="gentex-btn-confirm">
              Generate
              <span class="gentex-credits-badge" id="gentex-credits-badge">20 credits</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', template);

    this._overlay = document.getElementById('gentex-overlay');
    this._promptEl = document.getElementById('gentex-prompt');

    this._overlay.querySelectorAll('.gentex-style-card').forEach(card => {
      card.addEventListener('click', () => {
        this._overlay.querySelectorAll('.gentex-style-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this._selectedStyle = card.dataset.style;
      });
    });

    this._overlay.querySelectorAll('.gentex-res-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._overlay.querySelectorAll('.gentex-res-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedResolution = Number(btn.dataset.res);
      });
    });

    document.getElementById('gentex-close').addEventListener('click', () => this._closePanel(false));
    document.getElementById('gentex-cancel').addEventListener('click', () => this._closePanel(false));
    document.getElementById('gentex-confirm').addEventListener('click', () => this._closePanel(true));

    const RESOLUTION_COST = { 512: 20, 1024: 30, 2048: 40 };
    this._creditsBadge = document.getElementById('gentex-credits-badge');

    this._overlay.querySelectorAll('.gentex-res-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._overlay.querySelectorAll('.gentex-res-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedResolution = Number(btn.dataset.res);
        this._creditsBadge.textContent = `${RESOLUTION_COST[this._selectedResolution]} credits`;
      });
    });
  }

  _openPanel() {
    this.signals.disableKeyHandler.dispatch(true);
    this._overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this._promptEl.value = '';
    return new Promise(resolve => { this._resolvePanel = resolve; });
  }

  _closePanel(confirmed) {
    this.signals.disableKeyHandler.dispatch(false);
    this._overlay.classList.add('hidden');
    document.body.style.overflow = '';
    this._resolvePanel?.(confirmed);
    this._resolvePanel = null;
  }

  _bindEvents() {
    this.generateButton?.addEventListener('click', () => this._onGenerate());
  }

  async _onGenerate() {
    if (!auth.isLoggedIn()) {
      this.signals.showLoginPanel.dispatch();
      return;
    }

    const objects = this.selection.selectedObjects;
    const meshes = objects.filter(o => o?.isMesh);
    if (meshes.length === 0) {
      alert('Select at least one mesh.');
      return;
    }
    
    // UV unwrap each mesh
    const confirmed = await this._openPanel();
    if (!confirmed) return;

    const userPrompt = this._promptEl.value.trim();
    const stylePrompt = STYLE_PROMPTS[this._selectedStyle];
    const finalPrompt = userPrompt ? `${stylePrompt} ${userPrompt}` : stylePrompt;
    const resolution = this._selectedResolution;

    // UV unwrap each mesh
    this._showLoading('Unwrapping UVs');
    const bakeTargets = [];
    for (const object of meshes) {
      let uvOutput;
      try {
        uvOutput = await AutoUVUnwrap.unwrap(object.userData.meshData);
      } catch (e) {
        this._hideLoading();
        alert(`UV unwrap failed for "${object.name}".`);
        return;
      }

      if (!uvOutput || !uvOutput.positions || uvOutput.positions.length === 0 || uvOutput.indices.length === 0) {
        this._hideLoading();
        alert(`Invalid UV output for "${object.name}".`);
        return;
      }

      this.vertexEditor.setObject(object);
      this.vertexEditor.transform.updateGeometryAndHelpers();

      const bakeGeometry = AutoUVUnwrap._buildOutputGeometry(uvOutput);
      const tempBakeMesh = new THREE.Mesh(bakeGeometry);
      tempBakeMesh.matrixWorld.copy(object.matrixWorld);
      bakeTargets.push({ object, bakeGeometry, tempBakeMesh });
    }

    // Single capture pass
    await this._nextStep('Capturing views');
    const { blob: matcapBlob, views } = await this.renderer.captureMultiView(meshes, this.editor.sceneManager, this.cameraManager.camera, this.renderer.captureShadedRender, resolution);

    const { blob: normalBlob } = await this.renderer.captureMultiView(meshes, this.editor.sceneManager, this.cameraManager.camera, this.renderer.captureNormalRender, resolution);
    this.signals.shadingModeChanged.dispatch('solid');

    try {
      await this._nextStep('Generating texture');
      const results = await NanoBanana.generate([matcapBlob, normalBlob], {
        prompt: [
          finalPrompt,
          'Preserve the exact original shape.',
          'Keep exact view layout.',
          'Maintain consistent materials across all views.',
          'Do not duplicate views.',
          'Do not remove background.',
          'Do not include shadow.',
        ].join(' '),
        resolution,
      });
      const generatedBlob = await fetch(results[0].url).then(r => r.blob());

      this.ensureDefaultLight();

      await this._nextStep('Baking to meshes');
      for (const { object, bakeGeometry, tempBakeMesh } of bakeTargets) {
        const renderTarget = await TextureBaker.bake(
          this.renderer.renderer, tempBakeMesh, generatedBlob, views, resolution * 2
        );
        bakeGeometry.dispose();

        const rawBlob  = await TextureBaker.toBlob(this.renderer.renderer, renderTarget);
        const bakedBlob = await TexturePatchFill.fill(rawBlob, {
          patchRadius: 3, 
          iterations: 12, 
          spatialWeight: 0.01
        });
        const texture = await TextureBaker.blobToTexture(bakedBlob);
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.FrontSide });
        this.editor.execute(new SetMaterialCommand(this.editor, object, material));
      }

      this.signals.shadingModeChanged.dispatch('material');
      await this._nextStep();
    } catch (err) {
      console.log(err);
      bakeTargets.forEach(({ bakeGeometry }) => bakeGeometry.dispose());
      this._hideLoading();
      alert(getCreditsErrorMessage(err.reason)?? err.message);
    }
  }

  ensureDefaultLight() {
    let hasLight = false;
    this.sceneManager.mainScene.traverse(obj => {
      if (obj.isLight) {
        hasLight = true;
      }
    });

    if (!hasLight) {
      const light = this.objectFactory.createLight('Hemisphere');
      this.editor.execute(new AddObjectCommand(this.editor, light));
    }
  }

  _showLoading(message) {
    this.signals.disableKeyHandler.dispatch(true);

    this._loadingEl = document.createElement('div');
    this._loadingEl.className = 'gen-loading-overlay';
    this._loadingEl.innerHTML = `
      <div class="gen-loading-box">
        <div class="gen-step-row">
          <span class="gen-step-icon">
            <svg viewBox="0 0 24 24"><polyline points="4 12 9 17 20 6"/></svg>
          </span>
          <span class="gen-step-label">${message}</span>
        </div>
        <div class="gen-step-track"><div class="gen-step-bar"></div></div>
      </div>
    `;
    document.body.appendChild(this._loadingEl);
  }

  async _nextStep(message) {
    if (!this._loadingEl) return;
    const icon = this._loadingEl.querySelector('.gen-step-icon');
    const label = this._loadingEl.querySelector('.gen-step-label');

    icon.classList.add('done');
    await new Promise(r => setTimeout(r, 600));

    if (!message) {
      this._hideLoading();
      return;
    }

    icon.classList.remove('done');
    label.textContent = message;
  }

  _hideLoading() {
    this.signals.disableKeyHandler.dispatch(false);
    this._loadingEl?.remove();
    this._loadingEl = null;
  }
}