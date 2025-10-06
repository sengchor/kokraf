export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.selection = editor.selection;
    this.shortcuts = null;
    this.currentMode = 'object';
    
    this.init();
    this.setupListeners();
  }

  async init() {
    await this.config.loadSettings();
    this.shortcuts = this.config.get('shortcuts');

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.currentMode = newMode;
    });
  }

  onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }

    if (event.ctrlKey && event.key === this.shortcuts['undo']) {
      this.editor.undo();
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === this.shortcuts['undo']) {
      this.editor.redo();
    } else if (event.key === 'w') {
      this.editor.toolbar.setActiveTool('select');
    } else if (event.key === this.shortcuts['translate']) {
      this.editor.toolbar.setActiveTool('move');
    } else if (event.key === this.shortcuts['rotate']) {
      this.editor.toolbar.setActiveTool('rotate');
    } else if (event.key === this.shortcuts['scale']) {
      this.editor.toolbar.setActiveTool('scale');
    } else if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(true);
    }

    if (this.currentMode === 'object') {
      if (event.key === 'Delete') {
        this.signals.objectDeleted.dispatch();
      } else if (event.shiftKey && event.key.toLowerCase() === this.shortcuts['focus']) {
        this.signals.objectFocused.dispatch();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        } 
        this.signals.switchMode.dispatch('edit');
      }
    } else if (this.currentMode === 'edit') {
      if (event.key === 'f') {
        this.signals.createFaceFromVertices.dispatch();
      } else if (event.key === 'Delete') {
        this.signals.deleteSelectedFaces.dispatch();
      } else if (event.key === 'p') {
        this.signals.separateSelection.dispatch();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        this.signals.switchMode.dispatch('object');
      } else if (event.key === 'e') {
        this.editor.toolbar.setActiveTool('extrude');
      }
    } 
  }

  onKeyUp(event) {
    if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(false);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
  }
}