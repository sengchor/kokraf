export class UVResizer {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.resizer = document.getElementById('viewport-split-resizer');
    this.viewport3dPane = document.getElementById('viewport-3d-pane');
    this.uvPane = document.getElementById('uv-pane');
    this.rightPanel = document.getElementById('right-panel-container');
    this.dragging = false;

    const wrapperWidth = this.viewport3dPane.parentElement.getBoundingClientRect().width;
    const resizerWidth = this.resizer.getBoundingClientRect().width;
    const rightPanelWidth = this.rightPanel.getBoundingClientRect().width;

    const initialWidth = (wrapperWidth - resizerWidth - rightPanelWidth) / 2;

    this.viewport3dPane.style.flex = `0 0 ${Math.round(initialWidth)}px`;

    this.resizer.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.resizer.setPointerCapture(e.pointerId);
    });

    this.resizer.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;

      const wrapperRect = this.viewport3dPane.parentElement.getBoundingClientRect();
      const resizerWidth = this.resizer.getBoundingClientRect().width;
      
      const uvPaneMinWidth = parseFloat(getComputedStyle(this.uvPane).minWidth) || 200;
      const viewport3dMinWidth = parseFloat(getComputedStyle(this.viewport3dPane).minWidth) || 200;

      const maxWidth = wrapperRect.width - resizerWidth - uvPaneMinWidth;
      const pxWidth = e.clientX - wrapperRect.left;
      
      const clamped = Math.min(maxWidth, Math.max(viewport3dMinWidth, pxWidth));

      this.viewport3dPane.style.flex = `0 0 ${Math.round(clamped)}px`;
      
      this.signals.layoutChanged.dispatch(false);
    });

    this.resizer.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.resizer.releasePointerCapture(e.pointerId);
    });
  }
}