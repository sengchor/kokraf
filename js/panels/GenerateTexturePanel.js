import * as THREE from 'three';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { SetMaterialCommand } from '../commands/SetMaterialCommand.js';
import { auth } from '/supabase/services/AuthService.js';
import { getCreditsErrorMessage } from '/supabase/services/CreditsService.js';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { TextureBaker } from '../texture/TextureBaker.js';
import { NanoBanana } from '../texture/NanoBanana.js';

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

    this._bindEvents();
  }

  _bindEvents() {
    if (this.generateButton) {
      this.generateButton.addEventListener('click', () => this._onGenerate());
    }
  }

  async _onGenerate() {
    if (!auth.isLoggedIn()) {
      this.signals.showLoginPanel.dispatch();
      return;
    }

    const objects = this.selection.selectedObjects;
    if (objects.length > 1) {
      alert('Please select a single mesh, or merge the meshes into one.');
      return;
    }
    
    const object = objects[0];
    if (!(object && object.isMesh)) {
      alert('First, select a mesh, then click the generate button.');
      return;
    }

    const meshData = object.userData.meshData;
    
    this._showLoading('Unwrapping UVs');
    let uvOutput;
    try {
      uvOutput = await AutoUVUnwrap.unwrap(meshData);
    } catch (error) {
      console.error("UV Unwrapping crashed:", error);
      alert('Failed to process mesh geometry. The operation was aborted.');
      return;
    }
    
    if (!uvOutput || !uvOutput.positions || uvOutput.positions.length === 0 || uvOutput.indices.length === 0) {
      alert('UV unwrapping failed. Please check if your mesh topology is valid.');
      return;
    }
    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    const bakeGeometry = AutoUVUnwrap._buildOutputGeometry(uvOutput);
    const tempBakeMesh = new THREE.Mesh(bakeGeometry);
    tempBakeMesh.matrixWorld.copy(object.matrixWorld);

    await this._nextStep('Capturing views');
    const { blob: matcapBlob, views } = await this.renderer.captureMultiView(this.editor.sceneManager, this.cameraManager.camera, this.renderer.captureShadedRender);
    const { blob: normalBlob } = await this.renderer.captureMultiView(this.editor.sceneManager, this.cameraManager.camera, this.renderer.captureNormalRender);

    try {
      await this._nextStep('Generating texture');
      const results = await NanoBanana.generate([matcapBlob, normalBlob], {
        prompt: `Texture this 3D render with realistic materials.
        Generate realistic and natural colors. Camera photo realism.
        Preserve the exact original shape.
        Keep exact view layout.
        Do not duplicate views.
        Do not remove background.`,
      });
      const generatedBlob = await fetch(results[0].url).then(r => r.blob());

      await this._nextStep('Baking to mesh');
      const renderTarget = await TextureBaker.bake(
        this.renderer.renderer, tempBakeMesh, generatedBlob, views, 1024
      );
      bakeGeometry.dispose();

      const bakedBlob = await TextureBaker.toBlob(
        this.renderer.renderer,
        renderTarget
      );
      const texture = await TextureBaker.blobToTexture(bakedBlob);
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.FrontSide });

      this.ensureDefaultLight();
      this.editor.execute(new SetMaterialCommand(this.editor, object, material));

      this.signals.shadingModeChanged.dispatch('material');
      await this._nextStep();
    } catch (err) {
      bakeGeometry.dispose();
      this._hideLoading();
      alert(getCreditsErrorMessage(err.reason)?? err.message);
      return;
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