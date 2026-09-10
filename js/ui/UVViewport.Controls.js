import { floatingTooltip } from '../ui/FloatingTooltip.js';

export class UVViewportControls {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.uvActions = editor.uvActions;

    this.container = document.getElementById('uv-controls-container');

    this.syncSelection = false;
    this.ready = this.load();
  }

  async load() {
    await this.uiLoader.loadComponent('#uv-controls-container', 'components/uv-viewport-controls.html');
    this.syncButton = this.container.querySelector('#uv-sync-selection');
    this.uvTools = document.getElementById('uv-tools');
    
    if (this.uvTools) {
      this.toolButtons = this.uvTools.querySelectorAll('.selection-button');
      this.toolButtons.forEach(button => {
        button.addEventListener('click', () => {
          this.signals.uvToolChanged.dispatch(button.dataset.tool);
        });
      });
    }

    floatingTooltip.attach(this.container.querySelector('.uv-viewport-controls'));

    this.setupListeners();
  }

  setupListeners() {
    this.syncButton.addEventListener('click', () => {
      this.setSyncSelection(!this.syncSelection);
    });

    this.signals.uvToolChanged.add((tool) => {
      this.toolButtons.forEach(b => 
        b.classList.toggle('active', b.dataset.tool === tool)
      );
    });
  }

  setSyncSelection(enabled) {
    if (enabled === this.syncSelection) return;
    this.syncSelection = enabled;
    this.syncButton.classList.toggle('active', enabled);
    this.signals.uvSyncSelectionChanged.dispatch(enabled);
  }
}