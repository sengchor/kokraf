import { floatingTooltip } from '../ui/FloatingTooltip.js';

export class UVViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;

    this.container = document.getElementById('uv-controls-container');

    this.syncSelection = false;
    this.ready = this.load();
  }

  async load() {
    await this.uiLoader.loadComponent('#uv-controls-container', 'components/uv-viewport-controls.html');
    this.syncButton = this.container.querySelector('#uv-sync-selection');
    floatingTooltip.attach(this.container.querySelector('.uv-viewport-controls'));

    this.setupListeners();
  }

  setupListeners() {
    this.syncButton.addEventListener('click', () => {
      this.setSyncSelection(!this.syncSelection);
    });
  }

  setSyncSelection(enabled) {
    if (enabled === this.syncSelection) return;
    this.syncSelection = enabled;
    this.syncButton.classList.toggle('active', enabled);
    this.signals.uvSyncSelectionChanged.dispatch(enabled);
  }
}