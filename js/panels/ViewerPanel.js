import Viewer from '../viewer/Viewer.js';
import { fetchPublicProject } from '/supabase/services/ProjectService.js';

export class ViewerPanel {
  constructor() {
    this.init();
  }

  init() {
    const html = `
      <div id="viewer-overlay" class="viewer-overlay hidden">
        <div class="viewer-container">
          <button class="viewer-close">✕</button>
          <div class="viewer-progress hidden">
            <div class="viewer-progress-bar"></div>
          </div>
          <canvas id="viewer-canvas"></canvas>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    this.overlay = document.getElementById('viewer-overlay');
    this.canvas = document.getElementById('viewer-canvas');
    this.progress = this.overlay.querySelector('.viewer-progress');
    this.progressBar = this.overlay.querySelector('.viewer-progress-bar');

    this.overlay.querySelector('.viewer-close')
      .addEventListener('click', () => this.close());
  }

  async open(projectId) {
    this.overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this.canvas.style.visibility = 'hidden';
    this._setProgress(0);

    const json= await fetchPublicProject(projectId);
    this._setProgress(50);

    if (!this.viewer) {
      this.viewer = new Viewer(this.canvas);
    }
    await this.viewer.fromJSON(json);
    this._setProgress(100);

    await new Promise(r => setTimeout(r, 300));
    this._hideProgress();

    this.canvas.style.visibility = 'visible';
    this.viewer.animate();
  }

  close() {
    this.overlay.classList.add('hidden');
    document.body.style.overflow = '';

    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
      this.canvas.innerHTML = '';
    }
  }

  _setProgress(pct) {
    this.progress.classList.remove('hidden');
    this.progressBar.style.width = `${pct}%`;
  }

  _hideProgress() {
    this.progress.classList.add('hidden');
    this.progressBar.style.width = '0%';
  }
}