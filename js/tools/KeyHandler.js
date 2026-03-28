export class KeyHandler {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.shortcuts = null;
    this.currentMode = 'object';

    this.keysPressed = {};
    this.lastKey = null;
    this.lastKeyTime = 0;
    this.doubleTapThreshold = 300;
    this.isTransformDragging = false;

    this.activeInteraction = null;
    
    this.init();
    this.setupListeners();
  }

  async init() {
    await this.config.loadSettings();
    this.shortcuts = this.config.get('shortcuts');

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
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
    const key = event.key.toLowerCase();
    if (this.isTransformDragging && key !== this.lastKey) return;

    // Prevent the active element from consuming keyboard shortcuts
    if (document.activeElement) {
      document.activeElement.blur();
    }

    // Ignore repeat while held down
    if (this.keysPressed[key]) return;
    this.keysPressed[key] = true;

    let handled = false;

    /* ---------- Global shortcuts ---------- */
    if (event.ctrlKey && event.key === this.shortcuts['undo']) {
      this.editor.undo();
      handled = true;
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === this.shortcuts['undo']) {
      this.editor.redo();
      handled = true;
    } else if (event.key === 'w') {
      this.editor.toolbar.setActiveTool('select');
      handled = true;
    } else if (event.key === this.shortcuts['translate']) {
      const now = performance.now();
      const isDoubleTap = this.isDoubleTap(this.shortcuts['translate'], now);
      
      if (this.currentMode === 'edit' && isDoubleTap) {
        this.signals.editCancelTransform.dispatch();
        this.editor.toolbar.setActiveTool('edge-slide');
        this.signals.editEdgeSlideStart.dispatch();
      } else {
        this.editor.toolbar.setActiveTool('move');
        this.currentMode === 'object'
          ? this.signals.objectTransformStart.dispatch('translate')
          : this.signals.editTransformStart.dispatch('translate');
      }

      this.lastKey = this.shortcuts['translate'];
      this.lastKeyTime = now;

      handled = true;
    } else if (!event.ctrlKey && event.key === this.shortcuts['rotate']) {
      this.editor.toolbar.setActiveTool('rotate');
      this.currentMode === 'object'
        ? this.signals.objectTransformStart.dispatch('rotate')
        : this.signals.editTransformStart.dispatch('rotate');
      handled = true;
    } else if (event.key === this.shortcuts['scale']) {
      this.editor.toolbar.setActiveTool('scale');
      this.currentMode === 'object'
        ? this.signals.objectTransformStart.dispatch('scale')
        : this.signals.editTransformStart.dispatch('scale');
      handled = true;
    } else if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(true);
      handled = true;
    } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
      this.signals.originFocused.dispatch(true);
      handled = true;
    }

    /* ---------- Object mode ---------- */
    if (this.currentMode === 'object') {
      if (event.key === 'Delete') {
        this.signals.objectDeleted.dispatch();
        handled = true;
      } else if (event.shiftKey && event.key.toLowerCase() === this.shortcuts['focus']) {
        this.signals.objectFocused.dispatch();
        handled = true;
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        this.signals.switchMode.dispatch('edit');
        return;
      } else if (event.shiftKey && event.key.toLowerCase() === 'd') {
        this.signals.objectDuplicated.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        this.signals.objectJoined.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'a') {
        handled = true;
      } else if (event.shiftKey && event.key.toLowerCase() === 'a') {
        handled = true;
      } else if (event.key === 'a') {
        this.signals.objectSelectAll.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        this.signals.objectsCopied.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'v') {
        this.signals.objectsPasted.dispatch();
        handled = true;
      }
    }

    /* ---------- Edit mode ---------- */
    if (this.currentMode === 'edit') {
      if (event.key === 'w') {
        this.editor.toolbar.setActiveTool('select');
        handled = true;
      } else if (event.key === 'f') {
        this.signals.createElementFromVertices.dispatch();
        handled = true;
      } else if (event.key === 'p') {
        this.signals.separateSelection.dispatch();
        handled = true;
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        this.signals.switchMode.dispatch('object');
        return;
      } else if (event.key === 'e') {
        this.editor.toolbar.setActiveTool('extrude');
        this.signals.editExtrudeStart.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'r') {
        this.editor.toolbar.setActiveTool('loopcut');
        handled = true;
      } else if (event.key === 'k') {
        this.editor.toolbar.setActiveTool('knife');
        handled = true;
      } else if (event.shiftKey && event.key.toLowerCase() === 'd') {
        this.editor.toolbar.setActiveTool('select');
        this.signals.duplicateSelection.dispatch();
        handled = true;
      } else if (event.key === 'm') {
        this.signals.mergeSelection.dispatch();
        handled = true;
      } else if (event.key === 'y') {
        this.signals.splitSelection.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'a') {
        handled = true;
      } else if (event.shiftKey && event.key.toLowerCase() === 'a') {
        handled = true;
      } else if (event.key === 'a') {
        this.signals.editSelectAll.dispatch();
        handled = true;
      } else if (event.shiftKey && event.key.toLowerCase() === this.shortcuts['focus']) {
        this.signals.vertexFocused.dispatch();
        handled = true;
      } else if (event.ctrlKey && event.key.toLowerCase() === 'b') {
        this.editor.toolbar.setActiveTool('bevel');
        this.signals.editBevelStart.dispatch();
        handled = true;
      } else if (event.key === 'i') {
        this.editor.toolbar.setActiveTool('inset');
        this.signals.editInsetStart.dispatch();
        handled = true;
      } else if (event.key === 'l') {
        this.signals.mouseSelectLinked.dispatch();
        handled = true;
      }
    }

    if (handled) {
      event.preventDefault();

      // Blur only when we actually used the shortcut
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    delete this.keysPressed[key];

    if (event.key === 'Shift') {
      this.signals.multiSelectChanged.dispatch(false);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  startInteraction(type) {
    if (this.activeInteraction) return false;

    this.activeInteraction = type;
    return true;
  }

  endInteraction(type) {
    if (this.activeInteraction !== type) return;
    this.activeInteraction = null;
  }

  isDoubleTap(key, now) {
    return this.lastKey === key && (now - this.lastKeyTime) < this.doubleTapThreshold;
  }
}