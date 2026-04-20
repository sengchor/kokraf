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
          <canvas id="viewer-canvas"></canvas>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    this.overlay = document.getElementById('viewer-overlay');
    this.canvas = document.getElementById('viewer-canvas');

    this.overlay.querySelector('.viewer-close')
      .addEventListener('click', () => this.close());
  }

  async open(projectId) {
    this.overlay.classList.remove('hidden');

    const json= await fetchPublicProject(projectId);

    if (!this.viewer) {
      this.viewer = new Viewer(this.canvas);
    }
    await this.viewer.fromJSON(json);
    this.viewer.animate();
  }

  close() {
    this.overlay.classList.add('hidden');

    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
      this.canvas.innerHTML = '';
    }
  }
}