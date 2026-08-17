const MOBILE_BREAKPOINT = 1024;
const DESKTOP_PANEL_WIDTH = 325;
const MOBILE_PANEL_WIDTH = 250;

export default class PanelResizer {
  constructor(editor) {
    this.signals = editor.signals;
    this.renderer = editor.renderer;
    this.cameraManager = editor.cameraManager;
    this.viewportViewHelper = editor.viewportViewHelper;

    this.isRightPanelResizing = false;
    this.isOutlinerResizing = false;

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() => {
      this.onWindowResize();
    });

    this.signals.layoutChanged.add((updatePanel) => {
      this.onWindowResize(updatePanel);
    });

    this.signals.viewportCameraChanged.add(() => {
      this.onWindowResize();
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

      this.onWindowResize(false);
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
    const rightPanel = document.getElementById('right-panel-container');

    if (updatePanel) {
      this.updateRightPanelWidth();
    }

    const totalWidth = window.innerWidth - rightPanel.offsetWidth;
    const totalHeight = window.innerHeight + 30;

    const wrapper = document.getElementById('canvas-viewport-wrapper');
    if (wrapper) {
      wrapper.style.width = `${totalWidth}px`;
      wrapper.style.height = `${totalHeight}px`;
    }

    const viewport3dPane = document.getElementById('viewport-3d-pane');
    if (viewport3dPane) {
      const paneRect = viewport3dPane.getBoundingClientRect();
      const width = Math.round(paneRect.width);
      const height = Math.round(paneRect.height);

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

    this.adjustOutlinerHeight();
    this.adjustToolInputDisplayPosition(rightPanel.offsetWidth);
  }

  getRequiredViewportSpace(viewport3dPane, uvPane, splitResizer) {
    const isUVSplitActive = uvPane && !uvPane.classList.contains('hidden');

    const splitResizerWidth = splitResizer ? splitResizer.getBoundingClientRect().width : 4;
    const uvPaneMinWidth = parseFloat(getComputedStyle(uvPane).minWidth) || 100;
    const viewport3dMinWidth = parseFloat(getComputedStyle(viewport3dPane).minWidth) || 100;

    const isViewport3dPinned = /^0 0 /.test(viewport3dPane.style.flex || '');
    const viewport3dRequired = isViewport3dPinned
      ? viewport3dPane.getBoundingClientRect().width
      : viewport3dMinWidth;

    return viewport3dRequired + splitResizerWidth + uvPaneMinWidth;
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
