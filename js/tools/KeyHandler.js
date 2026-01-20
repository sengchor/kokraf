export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.selection = editor.selection;
    this.shortcuts = null;
    this.currentMode = 'object';
    this.keysPressed = {};
    this.isTransformDragging = false;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    
    this.init();
    this.setupListeners();
  }

  async init() {
    await this.config.loadSettings();
    this.shortcuts = this.config.get('shortcuts');

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.signals.multiSelectChanged.dispatch(false);
    });
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.currentMode = newMode;
    });

    this.signals.transformDragStarted.add(() => {
      this.isTransformDragging = true;
    });

    this.signals.transformDragEnded.add(() => {
      this.isTransformDragging = false;
    });
  }

  onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }
    if (this.isTransformDragging) return;

    // Prevent the active element from consuming keyboard shortcuts
    if (document.activeElement) {
      document.activeElement.blur();
    }

    // Ignore repeat while held down
    const key = event.key.toLowerCase();
    if (this.keysPressed[key]) return;
    this.keysPressed[key] = true;

    if (event.ctrlKey && event.key === this.shortcuts['undo']) {
      this.editor.undo();
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === this.shortcuts['undo']) {
      this.editor.redo();
    } else if (event.key === 'w') {
      this.editor.toolbar.setActiveTool('select');
    } else if (event.key === this.shortcuts['translate']) {
      this.editor.toolbar.setActiveTool('move');
      this.signals.objectTransformStart.dispatch('translate');
    } else if (event.key === this.shortcuts['rotate']) {
      this.editor.toolbar.setActiveTool('rotate');
      this.signals.objectTransformStart.dispatch('rotate');
    } else if (event.key === this.shortcuts['scale']) {
      this.editor.toolbar.setActiveTool('scale');
      this.signals.objectTransformStart.dispatch('scale');
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
      } else if (event.shiftKey && event.key.toLowerCase() === 'd') {
        this.signals.objectDuplicated.dispatch();
      }
    } else if (this.currentMode === 'edit') {
      if (event.key === 'w') {
        this.editor.toolbar.setActiveTool('select');
      } else if (event.key === 'f') {
        this.signals.createElementFromVertices.dispatch();
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
      } else if (event.ctrlKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.editor.toolbar.setActiveTool('loopcut');
      } else if (event.key === 'k') {
        this.editor.toolbar.setActiveTool('knife');
      }
    } 
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    this.keysPressed[key] = false;

    if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(false);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}