export class UVResizer {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.resizer = document.getElementById('viewport-split-resizer');
    this.viewport3dPane = document.getElementById('viewport-3d-pane');
    this.uvPane = document.getElementById('uv-pane');

    this.dragging = false;
    this.grabOffset = 0;

    this.ratio = 0.5;
    this.desiredWidth = null;

    this._observer = new ResizeObserver(() => {
      if (this.dragging) return;
      this.signals.layoutChanged.dispatch({ resetPanelWidth: false, uvSync: 'none' });
    });
    if (this.uvPane) this._observer.observe(this.uvPane);

    this.resizer.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.resizer.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-viewport-split');
      this.grabOffset = e.clientX - this.viewport3dPane.getBoundingClientRect().right;
    });

    this.resizer.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const m = this._measure();
      if (!m) return;

      const width = this._clamp(e.clientX - m.wrapperLeft - this.grabOffset, m);
      this.desiredWidth = width;
      this.ratio = m.available > 0 ? width / m.available : this.ratio;
      this._apply(width);

      this.signals.layoutChanged.dispatch({ resetPanelWidth: false, uvSync: 'none' });
    });

    const endDrag = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.resizer.hasPointerCapture(e.pointerId)) {
        this.resizer.releasePointerCapture(e.pointerId);
      }
      document.body.classList.remove('resizing-viewport-split');
      this.signals.layoutChanged.dispatch({ resetPanelWidth: false, uvSync: 'none' });
    };
    this.resizer.addEventListener('pointerup', endDrag);
    this.resizer.addEventListener('pointercancel', endDrag);
  }

  get isActive() {
    return this.uvPane && !this.uvPane.classList.contains('hidden');
  }

  syncToWindow() {
    if (!this.isActive) return;
    const m = this._measure();
    if (!m) return;

    this.desiredWidth = this.ratio * m.available;
    this._apply(this._clamp(this.desiredWidth, m));
  }

  syncToPanel() {
    if (!this.isActive) return;
    const m = this._measure();
    if (!m) return;

    if (this.desiredWidth == null) {
      this.desiredWidth = this.viewport3dPane.getBoundingClientRect().width;
    }
    this.ratio = m.available > 0 ? this.desiredWidth / m.available : this.ratio;
    this._apply(this._clamp(this.desiredWidth, m));
  }

  _measure() {
    const wrapper = this.viewport3dPane.parentElement;
    if (!wrapper) return null;

    const wrapperRect = wrapper.getBoundingClientRect();
    if (wrapperRect.width === 0) return null;

    const resizerWidth = this.resizer.getBoundingClientRect().width;

    const uvMin = parseFloat(getComputedStyle(this.uvPane).minWidth) || 200;
    const viewport3dMin = parseFloat(getComputedStyle(this.viewport3dPane).minWidth) || 200;

    return {
      wrapperLeft: wrapperRect.left,
      available: wrapperRect.width - resizerWidth,
      uvMin,
      viewport3dMin,
    };
  }

  _clamp(width, m) {
    const max = Math.max(m.viewport3dMin, m.available - m.uvMin);
    return Math.min(max, Math.max(m.viewport3dMin, width));
  }

  _apply(width) {
    this.viewport3dPane.style.flex = `0 0 ${Math.round(width)}px`;
    if (this.uvPane) this.uvPane.style.height = '100%';
  }
}