import * as THREE from 'three';
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { SetShadingCommand } from "../commands/SetShadingCommand.js";
import { MultiCommand } from '../commands/MultiCommand.js';

export default class ContextMenu {
  constructor( editor ) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;
    this.menuEl = null;
    this.currentMode = 'object';

    this.lastMouse = { x: 0, y: 0 };
    this.menuTrigger = null;

    this.load();
    this.setupListeners();
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
          this.handleAction(action);
          this.hide();
        });
      });
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
    if (!this.menuEl) return;

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

    this.menuEl.style.display = 'block';
    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
  }

  showSection(mode) {
    const section = this.menuEl.querySelector(`.menu-section[data-mode="${mode}"]`);
    if (section) section.style.display = 'block';
  }

  hide() {
    if (this.menuEl) {
      this.menuEl.style.display = 'none';
    }
  }

  handleAction(action) {
    if (action === 'delete-object') {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const multi = new MultiCommand(this.editor, 'Delete Objects');

      objects.forEach(object => {
        multi.add(new RemoveObjectCommand(this.editor, object));
      });

      this.editor.execute(multi);
      return;
    }

    if (action === 'shade-smooth' || action === 'shade-flat' || action === 'shade-auto') {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      objects.forEach(obj => {
        if (!(obj instanceof THREE.Mesh)) return;

        const currentShading = obj.userData.shading;
        if (action === 'shade-smooth' && currentShading !== 'smooth') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'smooth', currentShading));
        } else if (action === 'shade-flat' && currentShading !== 'flat') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'flat', currentShading));
        } else if (action === 'shade-auto' && currentShading !== 'auto') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'auto', currentShading));
        }
      });
      return;
    }

    if (action.startsWith('delete-') || action.startsWith('dissolve-')) {
      this.signals.deleteSelectedFaces.dispatch(action);
      return;
    }

    console.log('Invalid action:', action);
  }
}