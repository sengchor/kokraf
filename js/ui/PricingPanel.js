export class PricingPanel {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;

    this.load();
    this.setupListeners();
  }

  load() {
    this.uiLoader.loadComponent('#overlay-root-pricing', 'components/pricing-panel.html', () => {
      this.overlay = document.getElementById('pricing-overlay');

      document
        .getElementById('pricing-close')
        .addEventListener('click', () => this.close());
    });
  }

  setupListeners() {
    this.signals.showPricing.add(() => this.open());
  }

  open() {
    this.overlay.classList.remove('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
  }
}