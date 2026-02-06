export default class ContextMenu {
  constructor( editor ) {
    this.editor = editor;
    this.signals = editor.signals;
    this.keyHandler = editor.keyHandler;
    this.uiLoader = editor.uiLoader;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.objectActions = editor.objectActions;
    this.editActions = editor.editActions;
    this.menuEl = null;
    this.currentMode = 'object';
    this.closeTimeout = null;

    this.lastMouse = { x: 0, y: 0 };
    this.menuTrigger = null;

    this.ready = this.load();
    this.setupListeners();
  }

  async load() {
    const container = await this.uiLoader.loadComponent('#floating-container', 'components/context-menu.html');

    if (!container) return;

    this.menuEl = container.querySelector('.context-menu');
    this.wrapper = this.menuEl.closest('.context-menu-wrapper');

    const appContainer = document.querySelector('.app-container');
    appContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    const canvas = document.querySelector('#three-canvas');
    canvas.addEventListener('contextmenu', (e) => {
      if (e.button === 2) {
        e.preventDefault();

        this.menuTrigger = 'mouse';
        this.show(e.clientX, e.clientY);
      }
    });

    appContainer.addEventListener('contextmenu', (e) => {
      if (e.target !== canvas) {
        e.preventDefault();
        this.hide();
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('.context-menu')) return;
      this.hide();
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        if (e.target.closest('.context-menu')) return;
        this.hide();
      }
    });

    document.addEventListener('mousemove', (e) => {
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
    });

    this.menuEl.querySelectorAll('[data-action]').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');

        // Find the closest menu-section parent to know the mode
        const section = item.closest('.menu-section');
        const mode = section ? section.dataset.mode : 'object';

        if (mode === 'object') {
          this.objectActions.handleAction(action);
        } else if (mode === 'delete') {
          this.editActions.handleAction(action);
        }

        this.hide();
      });
    });

    this.wrapper.addEventListener('mouseenter', () => {
      if (this.closeTimeout) {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = null;
      }
    });

    this.wrapper.addEventListener('mouseleave', () => {
      this.closeTimeout = setTimeout(() => {
        this.hide();
      }, 250);
    });
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.currentMode = newMode;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') {
        this.menuTrigger = 'delete';
        this.show(this.lastMouse.x, this.lastMouse.y);
      }
    })
  }

  show(x, y) {
    if (!this.menuEl || !this.wrapper) return;

    this.menuEl.querySelectorAll('.menu-section').forEach(section => {
      section.style.display = 'none';
    });

    let visible = false;
    if (this.menuTrigger === 'mouse' && this.currentMode === 'object') {
      this.showSection('object');
      visible = true;
    }

    if (this.menuTrigger === 'delete' && this.currentMode === 'edit') {
      this.showSection('delete');
      visible = true;
    }

    if (!visible) return;

    this.wrapper.style.display = 'block';
    this.wrapper.style.left = `${x - 15}px`;
    this.wrapper.style.top = `${y - 15}px`;
  }

  showSection(mode) {
    if (!this.editor.keyHandler.startInteraction('context-menu')) return;
    const section = this.menuEl.querySelector(`.menu-section[data-mode="${mode}"]`);
    if (section) section.style.display = 'block';
  }

  hide() {  
    if (this.wrapper) {
      this.wrapper.style.display = 'none';
      this.editor.keyHandler.endInteraction('context-menu');
    }
  }
}