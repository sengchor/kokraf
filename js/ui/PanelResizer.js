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

    this.signals.layoutChanged.add(() => {
      this.onWindowResize();
    });

    this.signals.viewportCameraChanged.add(() => {
      this.onWindowResize();
    });
  }

  initRightPanelResizer() {
    const resizer = document.getElementById('right-panel-resizer');
    const rightPanel = document.getElementById('right-panel-container');
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

      const minWidth =
        window.innerWidth <= MOBILE_BREAKPOINT
          ? MOBILE_PANEL_WIDTH
          : DESKTOP_PANEL_WIDTH;

      const newWidth = window.innerWidth - e.clientX;

      if (newWidth >= minWidth && newWidth <= window.innerWidth - 2.5) {
        rightPanel.style.width = `${newWidth}px`;
        resizer.style.right = `${newWidth}px`;

        this.onWindowResize();
      }
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

  onWindowResize() {
    if (!this.isRightPanelResizing) {
      this.updateRightPanelWidth();
    }

    const rightPanel  = document.getElementById('right-panel-container');
    const width = window.innerWidth - rightPanel.offsetWidth;
    const height = window.innerHeight + 30;

    this.renderer.setSize(width, height);
    this.cameraManager.updateAspect(width / height);
    this.signals.viewportResized.dispatch(width, height);
    
    this.viewportViewHelper.updatePosition(this.renderer.domElement);
    this.adjustOutlinerHeight();

    const viewportControls = document.querySelector('.viewport-controls');
    if (viewportControls) {
      viewportControls.style.width = `${Math.max(width - 10, 0)}px`;
    }

    this.adjustBrushSettingsWidth(width);
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
}
