export default class ContextMenu {
  constructor( editor ) {
    this.editor = editor;
    this.uiLoader = editor.uiLoader;
    this.menuEl = null;

    this.load();
  }

  load() {
    this.uiLoader.loadComponent('#floating-container', 'components/context-menu.html', (container) => {
      this.menuEl = container.querySelector('.context-menu');

      const appContainer = document.querySelector('.app-container');
      appContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });

      const canvas = document.querySelector('#three-canvas');
      canvas.addEventListener('contextmenu', (e) => {
        if (e.button === 2) {
          e.preventDefault();
          this.show(e.clientX, e.clientY);
        }
        this.show(e.clientX, e.clientY);
      });

      appContainer.addEventListener('contextmenu', (e) => {
        if (e.target !== canvas) {
          e.preventDefault();
          this.hide();
        }
      });
      document.addEventListener('click', () => this.hide());
      document.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          this.hide();
        }
      });

      this.menuEl.querySelectorAll('[data-action]').forEach((item) => {
        item.addEventListener('click', () => {
          const action = item.getAttribute('data-action');
          this.handleAction(action);
          this.hide();
        });
      });
    });
  }

  show(x, y) {
    if (!this.menuEl) return;
    this.menuEl.style.display = 'block';
    this.menuEl.style.position = 'absolute';
    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
  }

  hide() {
    if (this.menuEl) {
      this.menuEl.style.display = 'none';
    }
  }

  handleAction(action) {
    if (action === 'shade-smooth') {
      console.log('Smooth shading applied');
    } else if (action === 'shade-flat') {
      console.log('Flat shading applied');
    } else if (action === 'delete') {
      console.log('Delete applied');
    } else {
      console.log('Unknown action:', action);
    }
  }
}