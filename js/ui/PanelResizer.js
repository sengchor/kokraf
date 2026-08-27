const MOBILE_BREAKPOINT = 1024;
const DESKTOP_PANEL_WIDTH = 325;
const MOBILE_PANEL_WIDTH = 250;

export default class PanelResizer {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.renderer = editor.renderer;
    this.cameraManager = editor.cameraManager;
    this.viewportViewHelper = editor.viewportViewHelper;

    this.isRightPanelResizing = false;
    this.isOutlinerResizing = false;

    window.addEventListener('resize', () =>
      this.applyLayout({ resetPanelWidth: true, uvSync: 'window' }));
    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() =>
      this.applyLayout({ resetPanelWidth: true, uvSync: 'window' }));

    this.signals.viewportCameraChanged.add(() =>
      this.applyLayout({ resetPanelWidth: true, uvSync: 'window' }));

    this.signals.layoutChanged.add((options) => {
      this.applyLayout(options || {});
    });
  }

  initRightPanelResizer() {
    const resizer = document.getElementById('right-panel-resizer');
    const rightPanel = document.getElementById('right-panel-container');
    const viewport3dPane = document.getElementById('viewport-3d-pane');
    const uvPane = document.getElementById('uv-pane');
    const splitResizer = document.getElementById('viewport-split-resizer');
    if (!resizer || !rightPanel) return;

    resizer.addEventListener('mousedown', () => {
      this.isRightPanelResizing = true;
      document.body.classList.remove('resizing-outliner');
      document.body.classList.add('resizing-right-panel');
      document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isRightPanelResizing) return;
      e.preventDefault();

      const minWidth = window.innerWidth <= MOBILE_BREAKPOINT ? MOBILE_PANEL_WIDTH : DESKTOP_PANEL_WIDTH;
      const minViewportSpace = this.getRequiredViewportSpace(viewport3dPane, uvPane, splitResizer);
      const maxWidth = window.innerWidth - minViewportSpace;

      let newWidth = window.innerWidth - e.clientX;
      newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

      rightPanel.style.width = `${newWidth}px`;
      resizer.style.right = `${newWidth}px`;

      this.signals.layoutChanged.dispatch();
    });

    document.addEventListener('mouseup', () => {
      if (this.isRightPanelResizing) {
        this.isRightPanelResizing = false;
        document.body.classList.remove('resizing-right-panel');
        document.body.style.cursor = 'default';
      }
    });
  }

  initOutlinerResizer() {
    const resizer = document.getElementById('outliner-resizer');
    const outliner = document.getElementById('outliner-list');
    if (!resizer || !outliner) return;

    resizer.addEventListener('mousedown', () => {
      this.isOutlinerResizing = true;
      document.body.classList.remove('resizing-right-panel');
      document.body.classList.add('resizing-outliner');
      document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isOutlinerResizing) return;

      const containerTop = outliner.getBoundingClientRect().top;
      const newHeight = e.clientY - containerTop - 20;

      if (newHeight >= 20 && newHeight <= window.innerHeight - containerTop - 30) {
        outliner.style.height = `${newHeight}px`;
        outliner.style.maxHeight = `${newHeight}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isOutlinerResizing) {
        this.isOutlinerResizing = false;
        document.body.classList.remove('resizing-outliner');
        document.body.style.cursor = 'default';
      }
    });
  }

  onWindowResize(updatePanel = true) {
    this.applyLayout({ resetPanelWidth: updatePanel, uvSync: 'window' });
  }

  applyLayout({ resetPanelWidth = false, uvSync = 'none' } = {}) {
    if (window.innerWidth === 0 || window.innerHeight === 0) return;

    const rightPanel = document.getElementById('right-panel-container');
    if (!rightPanel) return;

    if (resetPanelWidth) this.updateRightPanelWidth();

    const wrapper = document.getElementById('canvas-viewport-wrapper');
    if (wrapper) {
      wrapper.style.width = `${window.innerWidth - rightPanel.offsetWidth}px`;
      wrapper.style.height = `${window.innerHeight + 30}px`;
    }

    const uvResizer = this.editor.uvResizer;
    if (uvResizer) {
      if (uvSync === 'window') uvResizer.syncToWindow();
      else if (uvSync === 'panel') uvResizer.syncToPanel();
    }

    const viewport3dPane = document.getElementById('viewport-3d-pane');
    if (viewport3dPane) {
      const rect = viewport3dPane.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);

      if (width > 0 && height > 0) {
        this.renderer.setSize(width, height);
        this.cameraManager.updateAspect(width / height);
        this.signals.viewportResized.dispatch(width, height);
        this.viewportViewHelper.updatePosition(this.renderer.domElement);

        const viewportControls = document.querySelector('.viewport-controls');
        if (viewportControls) {
          viewportControls.style.width = `${Math.max(width - 10, 0)}px`;
        }
        this.adjustBrushSettingsWidth(width);
      }
    }

    this.adjustOutlinerHeight();
    this.adjustToolInputDisplayPosition(rightPanel.offsetWidth);
  }

  getRequiredViewportSpace(viewport3dPane, uvPane, splitResizer) {
    const viewport3dMin = parseFloat(getComputedStyle(viewport3dPane).minWidth) || 100;
    if (!uvPane || uvPane.classList.contains('hidden')) return viewport3dMin;

    const splitResizerWidth = splitResizer ? splitResizer.getBoundingClientRect().width : 4;
    const uvMin = parseFloat(getComputedStyle(uvPane).minWidth) || 100;

    const pinned = /^0 0 /.test(viewport3dPane.style.flex || '');
    const required = pinned ? viewport3dPane.getBoundingClientRect().width : viewport3dMin;

    return required + splitResizerWidth + uvMin;
  }

  adjustOutlinerHeight() {
    const outlinerList = document.getElementById('outliner-list');
    const sceneTab = document.getElementById('scene-tab');

    if (sceneTab && outlinerList) {
      const sceneTabRect = sceneTab.getBoundingClientRect();
      const maxHeight = window.innerHeight - sceneTabRect.top - 50;

      outlinerList.style.maxHeight = `${maxHeight}px`;
      outlinerList.style.overflowY = 'auto';
    }
  }

  adjustBrushSettingsWidth(availableWidth) {
    const brushSettings = document.getElementById('brush-settings');
    if (!brushSettings) return;

    if (availableWidth < 1070) {
      brushSettings.classList.add('compact-mode');
    } else {
      brushSettings.classList.remove('compact-mode');
    }

    if (availableWidth < 850) {
      brushSettings.classList.add('micro-mode');
    } else {
      brushSettings.classList.remove('micro-mode');
    }
  }

  updateRightPanelWidth() {
    const rightPanel = document.getElementById('right-panel-container');
    const resizer = document.getElementById('right-panel-resizer');

    if (!rightPanel || !resizer) return;

    const panelWidth = window.innerWidth <= MOBILE_BREAKPOINT
      ? MOBILE_PANEL_WIDTH : DESKTOP_PANEL_WIDTH;

    rightPanel.style.width = `${panelWidth}px`;
    resizer.style.right = `${panelWidth}px`;
  }

  adjustToolInputDisplayPosition(rightPanelWidth) {
    const toolInputDisplay = document.getElementById('tool-input-display');
    if (!toolInputDisplay) return;

    toolInputDisplay.style.right = `${rightPanelWidth + 10}px`;
  }
}
